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
  type RuntimeCrashConfig,
  type RuntimeRenderer,
  makeRuntimeCore,
} from 'foldkit/runtime-core'
import type {
  AnimatedValues,
  BackgroundRuntime,
  StrictView,
} from 'foldkit/strict'
import type { Subscriptions } from 'foldkit/subscription'
import type { Url } from 'foldkit/url'
import { Platform } from 'react-native'

import {
  type NativeAnimationHost,
  makeNativeAnimationHost,
} from './animationHost'
import { type NativeBuilder, makeNativeBuilder } from './builder'
import { type NativeDevToolsConfig, resolveNativeDevTools } from './devTools'
import { makeNativeHost, rootUrl } from './host'
import type { NativeInstrumentation } from './instrumentation'
import { type NativeLinking, expoLinking } from './linking'
import {
  isDevelopment,
  registerProgram,
  takeOverProgram,
} from './modelPreservation'
import type { NativeNode } from './node'

declare const performance: Readonly<{ now: () => number }>

type NativeAnimationServices = AnimatedValues | BackgroundRuntime

type NativeProgramBaseConfig<
  Model,
  Message,
  Resources,
  ManagedResourceServices,
> = Readonly<{
  /** Omit the Schema for an opaque in-memory Model. Development Fast Refresh
   * encodes and decodes the Model synchronously, so the Schema must require
   * no decoding or encoding services. */
  Model?: Schema.Codec<Model, any, never, never>
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
  /** Identifies the program across Fast Refresh in development. Defaults to
   * `main`. Programs alive at the same time need distinct ids. The replaced
   * program is interrupted asynchronously, so its Subscription and
   * ManagedResource finalizers can run after the new program has started. */
  id?: string
  animationHost?: NativeAnimationHost
  linking?: NativeLinking
  devTools?: NativeDevToolsConfig<Message>
  /** Opt-in timing hooks. When omitted, no timing code runs. */
  instrumentation?: NativeInstrumentation
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
  /** The edit revision the published frame's view saw. Text inputs read it
   * per frame, so an input in a reused Lazy subtree still sees new frames.
   * @internal */
  getSnapshotInputRevision: () => number
  /** Releases replay interaction gating after React commits the live snapshot. @internal */
  acknowledgeCommittedSnapshot: (snapshot: NativeNode<Message>) => void
  /** @internal */
  maybeInstrumentation: Option.Option<NativeInstrumentation>
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
  const maybeDevTools = resolveNativeDevTools(config.devTools, Platform.OS)
  const ModelCodec =
    config.Model ?? Schema.declare<Model>((_value): _value is Model => true)
  let inputRevision = 0
  const h = makeNativeBuilder<Message>()
  const id = config.id ?? 'main'
  const maybeInstrumentation = Option.fromNullishOr(config.instrumentation)
  const update = Option.match(maybeInstrumentation, {
    onNone: () => config.update,
    onSome: instrumentation => (model: Model, message: Message) => {
      const startedAt = performance.now()
      const update_ = config.update(model, message)
      const endedAt = performance.now()
      instrumentation.onUpdate(startedAt, endedAt)
      return update_
    },
  })
  const animationHost = config.animationHost ?? makeNativeAnimationHost()
  const maybeModelPreservation = isDevelopment()
    ? Option.map(Option.fromNullishOr(config.Model), modelSchema => ({
        encodeModel: Schema.encodeUnknownSync(Schema.toCodecJson(modelSchema)),
      }))
    : Option.none<Readonly<{ encodeModel: (model: Model) => unknown }>>()
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
  let snapshotInputRevision = 0
  let maybeReadLiveModel = Option.none<() => Model>()
  let enqueueMessage = (_message: Message): void => {}
  let isDisposed = false
  let isInteractionPaused = (): boolean => false
  let isLiveViewRestorePending = false
  let maybeRestoringSnapshot = Option.none<NativeNode<Message>>()
  let acknowledgeCommittedSnapshot = (
    _snapshot: NativeNode<Message>,
  ): void => {}

  const publish = (node: NativeNode<Message>): void => {
    snapshot = node
    snapshotInputRevision = inputRevision
    for (const listener of Array.fromIterable(listeners)) {
      if (isDisposed) {
        break
      }

      listener()
    }
  }

  const renderSync = Option.match(maybeInstrumentation, {
    onNone:
      () =>
      (model: Model): void => {
        const node = config.view(model, h)

        if (isLiveViewRestorePending) {
          maybeRestoringSnapshot = Option.some(node)
        }

        publish(node)
      },
    onSome:
      instrumentation =>
      (model: Model): void => {
        const startedAt = performance.now()
        const node = config.view(model, h)
        const endedAt = performance.now()
        instrumentation.onView(startedAt, endedAt)

        if (isLiveViewRestorePending) {
          maybeRestoringSnapshot = Option.some(node)
        }

        publish(node)
      },
  })

  const renderer: RuntimeRenderer<Model, Message> = context =>
    Effect.gen(function* () {
      const { status, readLiveModel, messageQueue, commitNotifier } = context
      const { isPausedNow, readViewState, setViewState } =
        context.devToolsIntegration
      isInteractionPaused = () => isPausedNow() || readViewState() === 'Paused'
      maybeReadLiveModel = Option.some(readLiveModel)
      enqueueMessage = messageQueue.enqueueMessage
      let maybeFrame = Option.none<number>()
      let maybeLastDirtyMessage = Option.none<Message>()

      acknowledgeCommittedSnapshot = committedSnapshot => {
        if (
          isDisposed ||
          status.isRuntimeDisposed ||
          status.isCrashed ||
          isPausedNow() ||
          Option.isNone(maybeRestoringSnapshot) ||
          maybeRestoringSnapshot.value !== committedSnapshot ||
          snapshot !== committedSnapshot
        ) {
          return
        }

        maybeRestoringSnapshot = Option.none()
        isLiveViewRestorePending = false
        setViewState('Live')
      }

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
        if (
          isDisposed ||
          status.isRuntimeDisposed ||
          status.isCrashed ||
          isPausedNow() ||
          (readViewState() === 'Paused' && !isLiveViewRestorePending)
        ) {
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

      const scheduleRenderFrame = (isRestoringLiveView = false): void => {
        if (isDisposed || status.isRuntimeDisposed || status.isCrashed) {
          return
        }

        if (isRestoringLiveView && readViewState() === 'Paused') {
          isLiveViewRestorePending = true
        }

        if (
          Option.isSome(maybeFrame) ||
          isPausedNow() ||
          (readViewState() === 'Paused' && !isLiveViewRestorePending)
        ) {
          return
        }

        commitNotifier.markCommitPending()
        maybeFrame = Option.some(requestAnimationFrame(renderFrame))
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
        scheduleRenderFrame,
        skipPendingViewTransition: Function.constVoid,
        devToolsRenderBridge: {
          renderReplay: model =>
            Effect.gen(function* () {
              if (isDisposed || status.isRuntimeDisposed || status.isCrashed) {
                return
              }

              const previousSnapshot = snapshot
              const previousViewState = readViewState()
              const wasLiveViewRestorePending = isLiveViewRestorePending
              const maybePreviousRestoringSnapshot = maybeRestoringSnapshot
              setViewState('Paused')
              isLiveViewRestorePending = false
              maybeRestoringSnapshot = Option.none()

              if (Option.isSome(maybeFrame)) {
                cancelAnimationFrame(maybeFrame.value)
                maybeFrame = Option.none()
              }

              status.isRenderingFrame = true
              yield* Effect.suspend(() =>
                Schema.decodeUnknownEffect(Schema.toType(ModelCodec))(model),
              ).pipe(
                Effect.flatMap(replayedModel =>
                  Effect.sync(() => {
                    publish(config.view(replayedModel, h))
                    maybeLastDirtyMessage = Option.none()
                  }),
                ),
                Effect.catchCause(cause =>
                  Effect.suspend(() => {
                    snapshot = previousSnapshot
                    setViewState(previousViewState)
                    isLiveViewRestorePending = wasLiveViewRestorePending
                    maybeRestoringSnapshot = maybePreviousRestoringSnapshot

                    if (!isPausedNow()) {
                      scheduleRenderFrame(true)
                    }

                    return Effect.failCause(cause)
                  }),
                ),
                Effect.ensuring(
                  Effect.sync(() => {
                    status.isRenderingFrame = false
                    settlePendingCommit()
                    messageQueue.drainPendingMessages()
                  }),
                ),
                Effect.orDie,
              )
            }),
          markRenderPending: Effect.sync(() => scheduleRenderFrame(true)),
        },
      }
    })

  const maybePreservedModel = Option.isSome(maybeModelPreservation)
    ? takeOverProgram(id, animationHost)
    : Option.none<unknown>()

  const runtime = makeRuntimeCore({
    runtimeId: `native-${nextRuntimeId++}`,
    kind: 'Element',
    ports: undefined,
    Model: ModelCodec,
    Flags: Schema.Void,
    configuredFlags: Option.none(),
    isFlagsRequired: false,
    init,
    update,
    ...(config.subscriptions && { subscriptions: config.subscriptions }),
    ...(config.managedResources && {
      managedResources: config.managedResources,
    }),
    resources,
    ...(config.crash && { crash: config.crash }),
    devTools: Option.isSome(maybeDevTools) ? maybeDevTools.value.config : false,
    renderer,
    ...(config.routing && { routing: config.routing }),
    host: makeNativeHost(
      config.linking ?? expoLinking,
      { isLaunchUrlReplayed: Option.isNone(maybePreservedModel) },
      maybeDevTools,
    ),
  })
  const fiber = Effect.runFork(
    runtime.start(Option.getOrUndefined(maybePreservedModel)),
  )
  const getSnapshot = (): NativeNode<Message> => snapshot
  let unregisterProgram = Function.constVoid

  const program: NativeProgram<Model, Message> = {
    animationHost,
    recordInputEvent: () => ++inputRevision,
    getSnapshotInputRevision: () => snapshotInputRevision,
    acknowledgeCommittedSnapshot: node => acknowledgeCommittedSnapshot(node),
    maybeInstrumentation,
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
      if (!isDisposed && !isInteractionPaused()) {
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
      unregisterProgram()
      Effect.runFork(Fiber.interrupt(fiber))
    },
  }

  if (Option.isSome(maybeModelPreservation)) {
    const { encodeModel } = maybeModelPreservation.value
    const encodeModelSafely = Option.liftThrowable(encodeModel)
    const readEncodedModel = (): Option.Option<unknown> =>
      Option.flatMap(maybeReadLiveModel, readLiveModel =>
        encodeModelSafely(readLiveModel()),
      )

    unregisterProgram = registerProgram(id, {
      animationHost,
      readEncodedModel,
      dispose: program.dispose,
    })
  }

  return program
}
