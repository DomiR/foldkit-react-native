import {
  Array,
  Cause,
  Effect,
  Fiber,
  Function,
  Layer,
  Option,
  Schema,
} from 'effect'
import type { Update } from 'foldkit'
import type { ManagedResources } from 'foldkit/managedResource'
import type { RoutingConfig } from 'foldkit/runtime'
import {
  makeRuntimeCore,
  type RuntimeCrashConfig,
  type RuntimeRenderer,
} from 'foldkit/runtime-core'
import type {
  AnimatedValues,
  BackgroundRuntime,
  StrictView,
} from 'foldkit/strict'
import type { Subscriptions } from 'foldkit/subscription'
import type { Url } from 'foldkit/url'

import {
  makeNativeAnimationHost,
  type NativeAnimationHost,
} from './animationHost'
import { type NativeBuilder, makeNativeBuilder } from './builder'
import { makeNativeHost, rootUrl } from './host'
import { type NativeLinking, expoLinking } from './linking'
import type { NativeNode } from './node'

type NativeAnimationServices = AnimatedValues | BackgroundRuntime

type NativeProgramBaseConfig<
  Model,
  Message,
  Resources,
  ManagedResourceServices,
> = Readonly<{
  /** Omit the Schema for an opaque in-memory Model. */
  Model?: Schema.Codec<Model, any, unknown, unknown>
  update: (
    model: Model,
    message: Message,
  ) => Update.Return<
    Model,
    Message,
    Resources | NativeAnimationServices | ManagedResourceServices
  >
  view:
    | StrictView<Model, Message>
    | ((model: Model, h: NativeBuilder<Message>) => NativeNode<Message>)
  subscriptions?: Subscriptions<
    Model,
    Message,
    Resources | NativeAnimationServices | ManagedResourceServices
  >
  managedResources?: ManagedResources<Model, Message, ManagedResourceServices>
  resources?: Layer.Layer<Resources>
  crash?: RuntimeCrashConfig<Model, Message>
  animationHost?: NativeAnimationHost
  linking?: NativeLinking
}>

/** The shared Elm Architecture program and its native view. Configure routing
 * to pass the current Url to `init` and receive native deep-link changes. */
export type NativeProgramConfig<
  Model,
  Message,
  Resources = never,
  ManagedResourceServices = never,
> = NativeProgramBaseConfig<
  Model,
  Message,
  Resources,
  ManagedResourceServices
> &
  (
    | Readonly<{
        routing: RoutingConfig<Message>
        init: (
          url: Url,
        ) => Update.Return<
          Model,
          Message,
          Resources | NativeAnimationServices | ManagedResourceServices
        >
      }>
    | Readonly<{
        routing?: undefined
        init: () => Update.Return<
          Model,
          Message,
          Resources | NativeAnimationServices | ManagedResourceServices
        >
      }>
  )

/** A native node store driven by Foldkit's runtime core. `getModel` reads live
 * state, while `getSnapshot` and `render` read the latest published frame. */
export type NativeProgram<Model, Message> = Readonly<{
  animationHost: NativeAnimationHost
  /** Advances the host's editing protocol for input adapters. @internal */
  recordInputEvent: () => number
  getModel: () => Model
  getSnapshot: () => NativeNode<Message>
  subscribe: (listener: () => void) => () => void
  dispatch: (message: Message) => void
  render: () => NativeNode<Message>
  dispose: () => void
}>

let nextRuntimeId = 0

/** Creates a native program using Foldkit's scoped Message queue, Commands,
 * Subscriptions, and ManagedResources. When routing is configured, `init`
 * receives the current Url and native deep-link changes dispatch
 * `routing.onUrlChange`. The animation host's Layer is provided alongside
 * application resources. `dispose` interrupts its runtime fiber. */
export const makeNativeProgram = <
  Model,
  Message,
  Resources = never,
  ManagedResourceServices = never,
>(
  config: NativeProgramConfig<
    Model,
    Message,
    Resources,
    ManagedResourceServices
  >,
): NativeProgram<Model, Message> => {
  let inputRevision = 0
  const h = makeNativeBuilder<Message>(() => inputRevision)
  const animationHost = config.animationHost ?? makeNativeAnimationHost()
  const resources = Layer.mergeAll(
    animationHost.layer,
    ...Array.fromOption(Option.fromNullishOr(config.resources)),
  )
  const init = (_flags: void, url?: Url) => {
    if (config.routing) {
      return config.init(url ?? rootUrl)
    }

    return config.init()
  }
  const listeners = new Set<() => void>()
  let snapshot = h.div([])
  let maybeReadLiveModel = Option.none<() => Model>()
  let enqueueMessage = (_message: Message): void => {}
  let isDisposed = false

  const publish = (node: NativeNode<Message>): void => {
    snapshot = node
    for (const listener of Array.fromIterable(listeners)) {
      if (isDisposed) {
        break
      }

      listener()
    }
  }

  const renderer: RuntimeRenderer<Model, Message> = context =>
    Effect.gen(function* () {
      const { status, readLiveModel, messageQueue, commitNotifier } = context
      maybeReadLiveModel = Option.some(readLiveModel)
      enqueueMessage = messageQueue.enqueueMessage
      let maybeFrame = Option.none<number>()
      let maybeLastDirtyMessage = Option.none<Message>()

      const settlePendingCommit = (): void => {
        if (commitNotifier.service.isCommitPending()) {
          commitNotifier.notifyCommitted()
        }
      }

      const crashWith = (
        cause: Cause.Cause<never>,
        maybeMessage: Option.Option<Message>,
      ): Effect.Effect<void> =>
        Effect.sync(() => {
          if (status.isCrashed || status.isRuntimeDisposed) {
            return
          }

          status.isCrashed = true
          if (Option.isSome(maybeFrame)) {
            cancelAnimationFrame(maybeFrame.value)
            maybeFrame = Option.none()
          }

          const squashed = Cause.squash(cause)
          const error =
            squashed instanceof Error
              ? squashed
              : new Error(globalThis.String(squashed))
          console.error('[foldkit/native] Application crash:', error)

          if (context.crash?.report) {
            try {
              context.crash.report({
                error,
                model: readLiveModel(),
                message: maybeMessage,
              })
            } catch (reportError) {
              console.error(
                '[foldkit/native] crash.report failed:',
                reportError,
              )
            }
          }

          publish(
            h.div(
              [h.Style({ padding: 24, gap: 12 })],
              [
                h.p(
                  [h.Style({ fontWeight: 'bold', color: '#dc2626' })],
                  ['Application crash'],
                ),
                h.p([], [error.message]),
                h.p([], [Cause.pretty(cause)]),
              ],
            ),
          )
          settlePendingCommit()
        })

      const renderSync = (model: Model): void => {
        publish(config.view(model, h))
      }

      const render = (model: Model): Effect.Effect<void> =>
        Effect.sync(() => {
          status.isRenderingFrame = true
          try {
            renderSync(model)
          } finally {
            status.isRenderingFrame = false
            messageQueue.drainPendingMessages()
          }
        })

      const renderFrame = (): void => {
        if (status.isRuntimeDisposed || status.isCrashed) {
          maybeFrame = Option.none()
          settlePendingCommit()
          return
        }

        if (messageQueue.isAnyMessageDeferred()) {
          maybeFrame = Option.some(requestAnimationFrame(renderFrame))
          return
        }

        maybeFrame = Option.none()
        messageQueue.resetDrainBudget()
        status.isRenderingFrame = true

        try {
          renderSync(readLiveModel())
        } catch (error) {
          Effect.runForkWith(context.runtimeContext)(
            crashWith(Cause.die(error), maybeLastDirtyMessage),
          )
        } finally {
          status.isRenderingFrame = false
        }

        messageQueue.drainPendingMessages()
        settlePendingCommit()
      }

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          animationHost.dispose()
          if (Option.isSome(maybeFrame)) {
            cancelAnimationFrame(maybeFrame.value)
            maybeFrame = Option.none()
          }

          settlePendingCommit()
        }),
      )

      return {
        crashWith,
        render,
        setLastDirtyMessage: message => {
          maybeLastDirtyMessage = Option.some(message)
        },
        scheduleRenderFrame: () => {
          if (
            Option.isSome(maybeFrame) ||
            status.isRuntimeDisposed ||
            status.isCrashed
          ) {
            return
          }

          commitNotifier.markCommitPending()
          maybeFrame = Option.some(requestAnimationFrame(renderFrame))
        },
        skipPendingViewTransition: Function.constVoid,
        devToolsRenderBridge: {
          renderReplay: () => Effect.void,
          markRenderPending: Effect.void,
        },
      }
    })

  const runtime = makeRuntimeCore({
    runtimeId: `native-${nextRuntimeId++}`,
    kind: 'Element',
    ports: undefined,
    Model:
      config.Model ?? Schema.declare<Model>((_value): _value is Model => true),
    Flags: Schema.Void,
    configuredFlags: Option.none(),
    isFlagsRequired: false,
    init,
    update: config.update,
    ...(config.subscriptions && { subscriptions: config.subscriptions }),
    ...(config.managedResources && {
      managedResources: config.managedResources,
    }),
    resources,
    ...(config.crash && { crash: config.crash }),
    devTools: false,
    renderer,
    ...(config.routing && { routing: config.routing }),
    host: makeNativeHost<Message>(config.linking ?? expoLinking),
  })
  const fiber = Effect.runFork(runtime.start())
  const getSnapshot = (): NativeNode<Message> => snapshot

  return {
    animationHost,
    recordInputEvent: () => ++inputRevision,
    getModel: () =>
      Option.getOrThrowWith(
        maybeReadLiveModel,
        () => new Error('[foldkit/native] The runtime has not initialized.'),
      )(),
    getSnapshot,
    subscribe: listener => {
      if (isDisposed) {
        return Function.constVoid
      }

      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    dispatch: message => {
      if (!isDisposed) {
        enqueueMessage(message)
      }
    },
    render: getSnapshot,
    dispose: () => {
      if (isDisposed) {
        return
      }

      isDisposed = true
      listeners.clear()
      Effect.runFork(Fiber.interrupt(fiber))
    },
  }
}
