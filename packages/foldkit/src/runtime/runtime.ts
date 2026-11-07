import {
  Array,
  Cause,
  Context,
  Effect,
  Exit,
  Fiber,
  Layer,
  Option,
  Predicate,
  PubSub,
  Result,
  Schema,
  pipe,
} from 'effect'

import type { BindableBlock } from '../block/binding.js'
import { commandInstances } from '../block/instanceContext.js'
import { assertComposedHandlers } from '../block/lowering.js'
import type { ManagedResources } from '../managedResource/index.js'
import type { Ports } from '../port/index.js'
import { RenderCommit, createCommitNotifier } from '../render/commit.js'
import * as Serialization from '../serialization.js'
import {
  type Registrations,
  aggregate as aggregateSubscriptions,
} from '../subscription/subscription.js'
import type { Return as UpdateReturn } from '../update/index.js'
import type { CapturedInvocation } from './compositionRuntime.js'
import {
  type CompositionRuntime,
  makeCompositionRuntime,
} from './compositionRuntime.js'
import { deepFreeze } from './deepFreeze.js'
import type { RuntimeDevToolsConfig } from './devToolsConfig.js'
import { makeDevToolsIntegration } from './devToolsIntegration.js'
import {
  type HostConnector,
  type PortChannelsBundle,
  makePortChannels,
  validatePorts,
} from './hostConnector.js'
import type { ResolvedHydrationHandoff } from './hydrationHandoff.js'
import type { Url } from '../url/index.js'
import type { RoutingConfig } from './browserListeners.js'
import { forkManagedResourceFibers } from './managedResourceFibers.js'
import { type MessageQueue, makeMessageQueue } from './messageQueue.js'
import type {
  BootMode,
  RuntimeCrashConfig,
  RuntimeHost,
  RuntimeRenderer,
} from './platform.js'
import { makeResourceProvider } from './resourceProvider.js'
import { makeRuntimeStatus } from './runtimeStatus.js'
import {
  type SlowConfig,
  type SlowUpdateContext,
  __resolveSlowConfig,
  measureSlowPhase,
  reportSlowPhase,
} from './slowPhase.js'
import { forkSubscriptionFibers } from './subscriptionFibers.js'
import { type Visibility, isVisible } from './visibility.js'

type AnyCommand<T, E = never, R = never> = {
  readonly name: string
  readonly args?: Record<string, unknown>
  readonly effect: Effect.Effect<T, E, R>
}

/** Configuration for a runtime with platform-supplied rendering and services.
 * @experimental The runtime platform contract may change between releases. */
export type RuntimeCoreConfig<
  Model,
  Message,
  Flags = void,
  Resources = never,
  ManagedResourceServices = never,
  P extends Ports | undefined = undefined,
  Kind extends 'Application' | 'Element' = 'Application' | 'Element',
  HostState = void,
> = Readonly<{
  runtimeId: string
  kind: Kind
  ports: P
  Model: Schema.Codec<Model, any, never, never>
  Flags: Schema.Codec<Flags, any, never, never>
  configuredFlags: Option.Option<Effect.Effect<Flags, never, Resources>>
  isFlagsRequired: boolean
  init: (
    flags: Flags,
    url?: Url,
  ) => UpdateReturn<Model, Message, Resources | ManagedResourceServices>
  update: (
    model: Model,
    message: Message,
  ) => UpdateReturn<Model, Message, Resources | ManagedResourceServices>
  renderer: RuntimeRenderer<Model, Message, HostState>
  host: RuntimeHost<Message, HostState>
  subscriptions?: Registrations<
    Model,
    Message,
    Resources | ManagedResourceServices
  >
  routing?: RoutingConfig<Message>
  crash?: RuntimeCrashConfig<Model, Message>
  slow?: SlowConfig<Model, Message>
  freezeModel?: boolean
  /**
   * Model-driven handle registrations collected from the completed Block
   * graph. The Runtime acquires and releases handles as their requirements
   * change. Features declare local registries with `managedResources`;
   * registered child bindings supply their occurrence-scoped registrations.
   */
  managedResources?: ManagedResources<Model, Message, ManagedResourceServices>
  /**
   * Services for a runtime started without a Block graph. Commands,
   * Subscriptions, ManagedResources, and the Flags Effect receive them. A
   * Program built from Blocks supplies its services through its Layers
   * instead.
   */
  applicationLayer?: Layer.Layer<Resources>
  devTools?: RuntimeDevToolsConfig
}>

/** Flags Schema used for startup and the server-to-browser hydration handoff. */
export type FlagsSchemaConfig<Flags> = Readonly<{
  /** Must encode and decode without Services, completing synchronously when
   * the hydration handoff runs it. Configuration does not evaluate the Codec. */
  Flags: Schema.Codec<Flags, any, never, never>
}>

/** A configured Foldkit runtime returned by `makeApplication` or `makeElement`.
 *  Pass it to `run` to start a page-owning app, or to `embed` to start it under
 *  a host-controlled lifecycle handle. `ports` is the Ports record from the
 *  config (or `undefined` when the config declared none); it types the
 *  `EmbedHandle` that `embed` returns. `Flags` and `Resources` carry the
 *  fresh-boot requirements from `makeApplication` to `run` and `embed`; they
 *  have no runtime representation.
 */
export type MakeRuntimeReturn<
  P extends Ports | undefined = undefined,
  Flags = void,
  Resources = never,
  Kind extends 'Application' | 'Element' = 'Application' | 'Element',
> = Readonly<{
  runtimeId: string
  start: (preservedModel?: unknown) => Effect.Effect<void>
  ports: P
  '~foldkit/RuntimeBoot'?: Readonly<{
    Flags: (flags: Flags) => Flags
    Resources: (resources: Resources) => Resources
    Kind: Kind
  }>
}>

type EmbedLifecycle = {
  isEmbedActive: boolean
  maybeActiveFiber: Option.Option<Fiber.Fiber<void>>
}

type RuntimeInternals = {
  resolvePreservedModel: Effect.Effect<unknown>
  provideScheduler: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>
  startWith: (
    maybeConnector: Option.Option<HostConnector>,
    preservedModel?: unknown,
    bootMode?: BootMode,
    flags?: Effect.Effect<any, never, any>,
    buildId?: string,
  ) => Effect.Effect<void>
  startWithApplicationLayer: (
    maybeConnector: Option.Option<HostConnector>,
    preservedModel: unknown,
    bootMode: BootMode,
    flags: Effect.Effect<any, never, any> | undefined,
    buildId: string | undefined,
    applicationLayer: Layer.Layer<never, any, any>,
    preparedHandoff?: ResolvedHydrationHandoff<any, any>,
    applicationMemoMap?: Layer.MemoMap,
  ) => Effect.Effect<void>
  applicationLayer?: Layer.Layer<never, any, any>
  compositionRoot?: BindableBlock
  kind: 'Application' | 'Element'
  embedLifecycle: EmbedLifecycle
}

export const runtimeInternals = new WeakMap<object, RuntimeInternals>()

/** Creates a platform-independent Foldkit runtime. Start its scoped Effect with
 * `start`, and interrupt that fiber to release Commands, Subscriptions, and resources.
 * @experimental The runtime platform contract may change between releases. */
export const makeRuntime = <
  Model,
  Message,
  Flags,
  Resources,
  ManagedResourceServices,
  P extends Ports | undefined,
  Kind extends 'Application' | 'Element',
  HostState,
>({
  ports,
  kind,
  Model,
  Flags: FlagsCodec,
  configuredFlags,
  isFlagsRequired,
  init,
  update,
  renderer,
  host,
  runtimeId,
  subscriptions,
  routing: routingConfig,
  crash,
  slow,
  freezeModel,
  managedResources,
  applicationLayer: configuredApplicationLayer,
  devTools,
}: RuntimeCoreConfig<
  Model,
  Message,
  Flags,
  Resources,
  ManagedResourceServices,
  P,
  Kind,
  HostState
>): MakeRuntimeReturn<P, Flags, Resources, Kind> => {
  const isSlowVisible = (show: Visibility): boolean =>
    isVisible(show, host.isDevelopment)

  const maybeResolvedSlow = __resolveSlowConfig(slow, isSlowVisible)

  const maybeSlowView = Option.flatMap(maybeResolvedSlow, ({ view }) => view)
  const maybeSlowUpdate = Option.flatMap(
    maybeResolvedSlow,
    ({ update }) => update,
  )
  const maybeSlowPatch = Option.flatMap(maybeResolvedSlow, ({ patch }) => patch)
  const maybeSlowSubscriptionDependencies = Option.flatMap(
    maybeResolvedSlow,
    ({ subscriptionDependencies }) => subscriptionDependencies,
  )

  const isFreezeModelActive = freezeModel !== false && host.isDevelopment

  const maybeFreezeModel = (model: Model): Model =>
    isFreezeModelActive ? deepFreeze(model) : model

  if (Predicate.isNotUndefined(ports)) {
    validatePorts(ports)
  }

  const startWith = (
    maybeConnector: Option.Option<HostConnector>,
    preservedModel?: unknown,
    bootMode: BootMode = 'Fresh',
    bootFlags?: Effect.Effect<Flags, never, Resources>,
    buildId?: string,
    applicationLayer?: Layer.Layer<never, any, any>,
    preparedHandoff?: ResolvedHydrationHandoff<Flags, Resources>,
    applicationMemoMap?: Layer.MemoMap,
  ): Effect.Effect<void> => {
    // NOTE: one notifier per runtime, provided across the whole runtime
    // Effect so Commands, Subscriptions, and Mount-forked Effects all resolve
    // the same signal. A commit in one embedded application must never wake a
    // `Render.afterCommit` awaiting inside another.
    const commitNotifier = createCommitNotifier()
    const hostServices = host.makeRuntimeServices()

    return Effect.scoped(
      Effect.gen(function* () {
        yield* host.validateRuntime

        // NOTE: every perpetual fiber (for example, Subscription streams
        // and ManagedResource lifecycles) and every Command fiber forks
        // into the runtime scope, so interrupting the runtime fiber (what
        // dispose does) interrupts them all and runs their finalizers. A
        // detached fork would outlive the runtime.
        const runtimeScope = yield* Effect.scope

        const { rendererState, resolveFlags } = yield* host.resolveBoot({
          bootMode,
          bootFlags,
          configuredFlags,
          isFlagsRequired,
          FlagsCodec,
          preservedModel,
          buildId,
          preparedHandoff,
        })

        const maybePortChannels: Option.Option<PortChannelsBundle> = pipe(
          Option.fromNullishOr(ports),
          Option.map(portsConfig =>
            makePortChannels(portsConfig, maybeConnector),
          ),
        )

        yield* Option.match(
          Option.all({
            connector: maybeConnector,
            portChannels: maybePortChannels,
          }),
          {
            onNone: () => Effect.void,
            onSome: ({ connector, portChannels }) =>
              Effect.acquireRelease(
                Effect.sync(() => connector.bind(portChannels.deliverInbound)),
                () => Effect.sync(() => connector.unbind()),
              ),
          },
        )

        const {
          applicationContext,
          managedResourceRefs,
          provideAllResources,
          provideApplicationServices,
        } = yield* makeResourceProvider({
          managedResources,
          runtimeScope,
          maybePortChannels,
          applicationLayer: applicationLayer ?? configuredApplicationLayer,
          applicationMemoMap,
        })

        const declaredComposition =
          runtimeInternals.get(program)?.compositionRoot
        if (declaredComposition !== undefined) {
          assertComposedHandlers(declaredComposition, applicationContext)
        }

        const ModelJsonCodec = Schema.toCodecJson(Model)
        const decodePreservedModel = Schema.decodeUnknownEffect(ModelJsonCodec)
        const encodePreservedModel = Schema.encodeEffect(ModelJsonCodec)
        let isPreservationFailing = false

        const encodeModelForPreservation = (model: Model): unknown =>
          Result.match(
            Serialization.run(
              encodePreservedModel(model),
              `Model preservation for runtime "${runtimeId}"`,
            ),
            {
              onFailure: error => {
                if (!isPreservationFailing) {
                  isPreservationFailing = true
                  console.warn(
                    `[foldkit] Could not preserve Model for runtime "${runtimeId}". ` +
                      'The live Model is unchanged; the next development reload will initialize fresh. ' +
                      'Use JSON-capable Schemas for values that must survive a reload.',
                    error,
                  )
                }
                return undefined
              },
              onSuccess: encodedModel => {
                isPreservationFailing = false
                return encodedModel
              },
            },
          )

        const maybeCurrentUrl = Option.flatMap(
          Option.fromNullishOr(routingConfig),
          () => host.currentUrl(),
        )

        type InitResult = ReturnType<typeof init>

        // NOTE: a restored Model skips `init`, so resolving Flags on that path
        // would perform startup work only to discard what it produced. This
        // has to stay ahead of the preserve-scheduler and preservation
        // finalizers: a Flags Effect that fails after those are registered
        // tears down more than it used to, and their release defects would
        // bury its cause.
        const runInit: Effect.Effect<InitResult> = Effect.map(
          provideApplicationServices(resolveFlags),
          flags => init(flags, Option.getOrUndefined(maybeCurrentUrl)),
        )

        const init_ = yield* preservedModel !== undefined
          ? Result.match(
              Serialization.run(
                decodePreservedModel(preservedModel),
                `Model restoration for runtime "${runtimeId}"`,
              ),
              {
                onFailure: error => {
                  if (error instanceof Serialization.SerializationError) {
                    console.warn(error.message, error.cause)
                  }

                  return runInit
                },
                onSuccess: restoredModel =>
                  Effect.succeed<InitResult>({ model: restoredModel }),
              },
            )
          : runInit
        const initModelRaw = init_.model
        const initCommands = init_.commands ?? []

        const schedulePreserveModel = yield* host.makeModelPreserver(
          encodeModelForPreservation,
        )

        const status = makeRuntimeStatus()

        // NOTE: `processMessagePlain` and `crashWith` are defined further
        // down, so they are wrapped here instead of passed by reference. The
        // queue has to exist before the navigation listeners attach below,
        // and reading a `const` before its line has run throws. The type
        // annotation is needed too: the `crashWith` wrapper calls the
        // renderer's, and the renderer takes this queue, so without it
        // TypeScript cannot infer either one.
        const messageQueue: MessageQueue<
          Message,
          Effect.Effect<Option.Option<number>>
        > = yield* makeMessageQueue<
          Message,
          Effect.Effect<Option.Option<number>>
        >({
          status,
          makeDrainScheduler: host.makeDrainScheduler,
          processMessage: message => processMessagePlain(message),
          crashWith: (cause, maybeMessage) => crashWith(cause, maybeMessage),
        })
        const {
          enqueueMessage,
          enqueueMessageEffect,
          enqueueMessageReceiptEffect,
          completeBoot,
        } = messageQueue

        const initModel = maybeFreezeModel(initModelRaw)

        const modelPubSub = yield* PubSub.unbounded<Model>()
        let composition: CompositionRuntime<Model> | undefined
        const enqueuePreparedDispatch = (
          message: Message,
          isCurrent?: () => boolean,
        ): Effect.Effect<Result.Result<Option.Option<number>, string>> =>
          Effect.flatMap(
            enqueueMessageReceiptEffect(message, isCurrent),
            Result.match({
              onFailure: (
                reason,
              ): Effect.Effect<Result.Result<Option.Option<number>, string>> =>
                Effect.succeed(Result.fail(reason)),
              onSuccess: (
                maybeRecording,
              ): Effect.Effect<Result.Result<Option.Option<number>, string>> =>
                Option.match(maybeRecording, {
                  onNone: () =>
                    Effect.succeed(Result.succeed(Option.none<number>())),
                  onSome: recording => Effect.map(recording, Result.succeed),
                }),
            }),
          )
        const prepareDispatch = (message: unknown) => {
          /* eslint-disable-next-line @typescript-eslint/consistent-type-assertions */
          const decodedMessage = message as Message
          if (composition === undefined) {
            return Result.succeed(enqueuePreparedDispatch(decodedMessage))
          }

          const isCurrent = composition.externalMessageGuard(decodedMessage)
          return isCurrent === undefined
            ? Result.fail(
                'Rejected stale child Message: its placement, key, or generation does not identify the currently active occurrence.',
              )
            : Result.succeed(enqueuePreparedDispatch(decodedMessage, isCurrent))
        }
        const devToolsIntegration = yield* makeDevToolsIntegration<
          Model,
          Message
        >({
          devTools,
          update,
          maybeFreezeModel,
          prepareDispatch,
          isDevelopment: host.isDevelopment,
          isDevToolsDevelopment: host.isDevToolsDevelopment(),
          connectStore: (store, prepareExternalDispatch) =>
            host.connectDevTools(store, prepareExternalDispatch, devTools),
        })
        const {
          isRecordingCommands,
          installDevToolsStore,
          recordInit,
          recordMessage,
          recordCommandResult,
        } = devToolsIntegration

        let nextCommandId = 0
        const assignCommandIds = <
          CommandType extends Readonly<{
            name: string
            args?: Record<string, unknown>
          }>,
        >(
          commands: ReadonlyArray<CommandType>,
        ) =>
          Array.map(commands, command => ({
            id: nextCommandId++,
            command,
          }))

        if (routingConfig) {
          yield* Effect.acquireRelease(
            Effect.sync(() =>
              host.addNavigationListeners(enqueueMessage, routingConfig),
            ),
            removeNavigationEventListeners =>
              Effect.sync(() => removeNavigationEventListeners()),
          )
        }

        // NOTE: the Model is plain closure state. `processMessagePlain`
        // reads and writes it directly, and the render side (the frame, and
        // `crashWith` inside its `Effect.sync`) reads it synchronously
        // through `readLiveModel`, so no Ref is needed.
        let liveModel: Model = initModel

        // NOTE: the runtime context for OnMount forking and Command forking
        // is captured once here; it is constant for the lifetime of the
        // runtime.
        const nativeRuntimeContext = Context.merge(
          yield* Effect.context<never>(),
          applicationContext,
        )
        const compositionRoot = runtimeInternals.get(program)?.compositionRoot
        const runtimeContext: Context.Context<never> =
          compositionRoot === undefined
            ? nativeRuntimeContext
            : (composition = yield* makeCompositionRuntime({
                block: compositionRoot,
                initModel,
                context: nativeRuntimeContext,
                runtimeScope,
                enqueueMessage,
                maybeSlowSubscriptionDependencies,
                crashWith: (cause, message) => crashWith(cause, message),
              })).context

        const {
          crashWith,
          render,
          setLastDirtyMessage,
          scheduleRenderFrame,
          skipPendingViewTransition,
          devToolsRenderBridge,
        } = yield* renderer({
          status,
          crash,
          buildId,
          initModel,
          hostState: rendererState,
          maybeSlowView,
          maybeSlowPatch,
          commitNotifier,
          runtimeContext,
          readLiveModel: () => liveModel,
          messageQueue,
          devToolsIntegration,
        })

        yield* Effect.addFinalizer(() => hostServices.releaseRendererResources)

        // NOTE: the fork is deferred one microtask so a Command's Effect
        // never begins on the dispatching stack. Commands are facts from
        // outside the update loop; their results always arrive
        // asynchronously, exactly as under the old queue. The fork runs
        // through `Effect.runForkWith` (which starts its fiber
        // synchronously, so the child is registered in `runtimeScope`
        // before this callback returns), not `Effect.runSyncWith`:
        // `runSyncWith` injects a temporary synchronous scheduler into the
        // fiber context, the child would inherit it, and every later yield
        // in the Command (for example, an op-budget suspension, or a
        // Stream step) would reschedule through clamped `setTimeout`
        // instead of the browser microtask scheduler carried by
        // `runtimeContext`.
        const forkCommand = (
          command: AnyCommand<
            Message,
            never,
            Resources | ManagedResourceServices
          >,
          message: Option.Option<Message>,
          id?: number,
          origin?: CapturedInvocation,
        ): void => {
          const captured = origin ?? composition?.capture(command)
          if (composition !== undefined && captured === undefined) {
            return
          }
          queueMicrotask(() => {
            // NOTE: `isCrashed` as well as `isRuntimeDisposed`. A crash is
            // terminal but does not dispose the runtime, and a Command forked
            // by a Message processed just before the crashing Message sits in
            // this microtask when the crash view paints. Without the crash
            // check its effect would run behind the crash view, contradicting
            // the crash-terminality contract. `crashWith` sets `isCrashed`
            // synchronously, so it is already set by the time this runs.
            if (
              status.isRuntimeDisposed ||
              status.isCrashed ||
              captured?.isCurrent() === false
            ) {
              return
            }

            const providedCommand = (
              captured === undefined
                ? provideAllResources(command.effect)
                : Effect.provideContext(
                    command.effect,
                    Context.makeUnsafe<Resources | ManagedResourceServices>(
                      captured.context.mapUnsafe,
                    ),
                  )
            ).pipe(
              Effect.withSpan(command.name, {
                attributes: command.args ?? {},
              }),
            )
            const mapResult = captured?.mapResult
            const deliveredCommand =
              mapResult === undefined
                ? providedCommand
                : providedCommand.pipe(Effect.map(result => mapResult(result)))
            const recordedCommand =
              id !== undefined
                ? deliveredCommand.pipe(
                    Effect.tap(result =>
                      Effect.sync(() => recordCommandResult(id, result)),
                    ),
                  )
                : deliveredCommand

            Effect.runForkWith(runtimeContext)(
              Effect.forkIn(captured?.scope ?? runtimeScope)(
                Effect.uninterruptibleMask(restore =>
                  restore(
                    recordedCommand.pipe(
                      Effect.flatMap(result =>
                        enqueueMessageEffect(result, captured?.isCurrent),
                      ),
                    ),
                  ).pipe(
                    Effect.catchCause(cause => {
                      if (Cause.hasInterruptsOnly(cause)) {
                        return Effect.void
                      } else {
                        return crashWith(cause, message)
                      }
                    }),
                  ),
                ),
              ),
            )
          })
        }

        const processMessagePlain = (
          message: Message,
        ): Effect.Effect<Option.Option<number>> => {
          const currentModel = liveModel

          const [messageUpdate, maybeUpdateDuration] = measureSlowPhase(
            maybeSlowUpdate,
            () => update(currentModel, message),
          )
          const nextModelRaw = messageUpdate.model
          const commands = messageUpdate.commands ?? []
          const nextModel = maybeFreezeModel(nextModelRaw)
          const commandOrigins = new Map<object, CapturedInvocation>()
          if (composition !== undefined) {
            for (const command of commands) {
              if (
                !commandInstances(command).some(
                  frame => frame.isInitialization === true,
                )
              ) {
                const origin = composition.capture(command)
                if (origin !== undefined) {
                  commandOrigins.set(command, origin)
                }
              }
            }
          }

          reportSlowPhase<SlowUpdateContext<Model, Message>>(
            maybeSlowUpdate,
            maybeUpdateDuration,
            (durationMs, thresholdMs) => ({
              _tag: 'Update',
              previousModel: currentModel,
              nextModel,
              message,
              durationMs,
              thresholdMs,
            }),
          )

          if (currentModel !== nextModel) {
            liveModel = nextModel
            composition?.synchronize(nextModel)
            setLastDirtyMessage(message)
            PubSub.publishUnsafe(modelPubSub, nextModel)
            if (host.isDevelopment) {
              Effect.runSync(schedulePreserveModel(nextModel))
            }
            scheduleRenderFrame()
          }

          if (isRecordingCommands) {
            const commandInvocations = assignCommandIds(commands)

            for (const { command, id } of commandInvocations) {
              forkCommand(
                /* eslint-disable-next-line @typescript-eslint/consistent-type-assertions */
                command as AnyCommand<
                  Message,
                  never,
                  Resources | ManagedResourceServices
                >,
                Option.some(message),
                id,
                commandOrigins.get(command),
              )
            }

            const recording = Effect.runForkWith(runtimeContext)(
              recordMessage(
                message,
                currentModel,
                nextModel,
                commandInvocations,
              ),
            )
            return Fiber.join(recording)
          } else {
            for (const command of commands) {
              forkCommand(
                /* eslint-disable-next-line @typescript-eslint/consistent-type-assertions */
                command as AnyCommand<
                  Message,
                  never,
                  Resources | ManagedResourceServices
                >,
                Option.some(message),
                undefined,
                commandOrigins.get(command),
              )
            }
            return Effect.succeed(Option.none())
          }
        }

        yield* Effect.provideContext(
          installDevToolsStore(devToolsRenderBridge),
          runtimeContext,
        )

        const initRenderExit = yield* Effect.exit(
          render(initModel, Option.none()),
        )
        if (Exit.isFailure(initRenderExit)) {
          yield* crashWith(initRenderExit.cause, Option.none())
          // NOTE: suspend instead of returning. Completing would close the
          // runtime scope and tear down the crash view; the scope must stay
          // open until the runtime is interrupted (an embedded app's dispose)
          // or the document goes away.
          return yield* Effect.never
        }

        yield* host.afterInitialRender

        const initCommandInvocations = isRecordingCommands
          ? assignCommandIds(initCommands)
          : []
        if (isRecordingCommands) {
          yield* recordInit(initModel, initCommandInvocations)
        }

        if (composition !== undefined) {
          yield* composition.start
        }

        if (composition === undefined) {
          yield* forkManagedResourceFibers({
            managedResourceRefs,
            initModel,
            modelPubSub,
            runtimeScope,
            enqueueMessageEffect,
            provideAllResources,
            crashWith,
          })
        }

        if (composition === undefined && subscriptions) {
          yield* forkSubscriptionFibers({
            subscriptions: aggregateSubscriptions(subscriptions),
            initModel,
            modelPubSub,
            runtimeScope,
            maybeSlowSubscriptionDependencies,
            enqueueMessageEffect,
            provideAllResources,
            crashWith,
          })
        }

        // NOTE: registered before the boot buffer drains, so an interrupt
        // landing anywhere after this yield tears down with the flag set
        // (finalizers are LIFO; this one runs before every
        // earlier-registered teardown, including the container-restoring
        // patch whose OnUnmount dispatches must be dropped). An interrupt
        // landing before this yield tears down with isBootComplete still
        // false, so every dispatch buffers and dies with the closure.
        // Either way no Message is processed against a closing runtime.
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            status.isRuntimeDisposed = true
            // NOTE: a transition outliving the runtime would keep animating
            // over a container the teardown is about to restore.
            skipPendingViewTransition()
          }),
        )

        // NOTE: init Commands fork as the last act of boot, exactly where
        // the old queue's drain loop used to start. Together with the
        // isBootComplete barrier this guarantees no Command result (or any
        // other Message) is processed until the init render has painted
        // initModel and every boot subsystem (DevTools store, Subscriptions,
        // ManagedResources, ports) is attached. forkCommand also defers each
        // start by a microtask, so a fully synchronous init Command still
        // delivers its result asynchronously.
        if (isRecordingCommands) {
          for (const { command, id } of initCommandInvocations) {
            forkCommand(
              /* eslint-disable-next-line @typescript-eslint/consistent-type-assertions */
              command as AnyCommand<
                Message,
                never,
                Resources | ManagedResourceServices
              >,
              Option.none(),
              id,
            )
          }
        } else {
          for (const command of initCommands) {
            forkCommand(
              /* eslint-disable-next-line @typescript-eslint/consistent-type-assertions */
              command as AnyCommand<
                Message,
                never,
                Resources | ManagedResourceServices
              >,
              Option.none(),
            )
          }
        }

        completeBoot()

        // NOTE: suspend forever. Messages are processed synchronously on
        // the dispatching stack and render frames run as plain rAF
        // callbacks, so this fiber's only remaining job is keeping the
        // runtime scope open until interruption (an embedded app's dispose)
        // or the document goes away.
        return yield* Effect.never
      }),
    ).pipe(
      Effect.provideService(RenderCommit, commitNotifier.service),
      hostServices.provideRuntime,
    )
  }

  const start = (preservedModel?: unknown): Effect.Effect<void> =>
    startWith(Option.none(), preservedModel, 'Fresh')

  const program: MakeRuntimeReturn<P, Flags, Resources, Kind> = {
    runtimeId,
    start,
    ports,
  }
  runtimeInternals.set(program, {
    resolvePreservedModel: host.resolvePreservedModel,
    provideScheduler: host.provideScheduler,
    startWith: (maybeConnector, preservedModel, bootMode, flags, buildId) =>
      startWith(maybeConnector, preservedModel, bootMode, flags, buildId),
    startWithApplicationLayer: (
      maybeConnector,
      preservedModel,
      bootMode,
      flags,
      buildId,
      applicationLayer,
      preparedHandoff,
      applicationMemoMap,
    ) =>
      startWith(
        maybeConnector,
        preservedModel,
        bootMode,
        flags,
        buildId,
        applicationLayer,
        preparedHandoff,
        applicationMemoMap,
      ),
    kind,
    embedLifecycle: {
      isEmbedActive: false,
      maybeActiveFiber: Option.none(),
    },
  })
  return program
}
