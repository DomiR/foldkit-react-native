import type { Cause, Context, Effect, Option, Schema, Scope } from 'effect'

import type { DevToolsStore } from '../devTools/store.js'
import type { PrepareDispatch } from '../devTools/webSocketBridge.js'
import type { CommitNotifier } from '../render/commit.js'
import type { Url } from '../url/index.js'
import type { RoutingConfig } from './browserListeners.js'
import type { CrashContext } from './crashUI.js'
import type { RuntimeDevToolsConfig } from './devToolsConfig.js'
import type {
  DevToolsIntegration,
  DevToolsRenderBridge,
} from './devToolsIntegration.js'
import type { DrainScheduler } from './drainScheduler.js'
import type { ResolvedHydrationHandoff } from './hydrationHandoff.js'
import type { MessageQueue } from './messageQueue.js'
import type { RuntimeStatus } from './runtimeStatus.js'
import type {
  ResolvedSlowPhaseConfig,
  SlowPatchContext,
  SlowViewContext,
} from './slowPhase.js'

/** Selects fresh initialization or a host-provided hydration handoff.
 * @experimental The runtime platform contract may change between releases. */
export type BootMode = 'Fresh' | 'Hydrate'

/** Reports an unrecoverable runtime error. The renderer owns its crash view.
 * @experimental The runtime platform contract may change between releases. */
export type RuntimeCrashConfig<Model, Message> = Readonly<{
  report?: (context: CrashContext<Model, Message>) => void
}>

/** Services shared by the core and one scoped renderer instance.
 * @experimental The runtime platform contract may change between releases. */
export type RendererContext<Model, Message, HostState = void> = Readonly<{
  status: RuntimeStatus
  crash: RuntimeCrashConfig<Model, Message> | undefined
  buildId: string | undefined
  initModel: Model
  hostState: HostState
  maybeSlowView: Option.Option<
    ResolvedSlowPhaseConfig<SlowViewContext<Model, Message>>
  >
  maybeSlowPatch: Option.Option<
    ResolvedSlowPhaseConfig<SlowPatchContext<Model, Message>>
  >
  commitNotifier: CommitNotifier
  runtimeContext: Context.Context<never>
  readLiveModel: () => Model
  messageQueue: MessageQueue<Message, unknown>
  devToolsIntegration: DevToolsIntegration<Model, Message>
}>

/** Rendering operations used by the core. A crash must set `status.isCrashed`
 * before painting, and scheduled frames must stop after crash or disposal.
 * @experimental The runtime platform contract may change between releases. */
export type RendererHandle<Model, Message> = Readonly<{
  crashWith: (
    cause: Cause.Cause<never>,
    maybeMessage: Option.Option<Message>,
  ) => Effect.Effect<void>
  render: (
    model: Model,
    maybeMessage: Option.Option<Message>,
  ) => Effect.Effect<void>
  setLastDirtyMessage: (message: Message) => void
  scheduleRenderFrame: () => void
  skipPendingViewTransition: () => void
  devToolsRenderBridge: DevToolsRenderBridge
}>

/** Acquires a renderer before the core forks lifetime-scoped fibers. Register
 * teardown here so those fibers release before the rendered tree does.
 * @experimental The runtime platform contract may change between releases. */
export type RuntimeRenderer<Model, Message, HostState = void> = (
  context: RendererContext<Model, Message, HostState>,
) => Effect.Effect<RendererHandle<Model, Message>, never, Scope.Scope>

/** Boot inputs the host uses to resolve Flags and a hydration handoff.
 * @experimental The runtime platform contract may change between releases. */
export type RuntimeBootContext<Flags, Resources> = Readonly<{
  bootMode: BootMode
  bootFlags: Effect.Effect<Flags, never, Resources> | undefined
  configuredFlags: Option.Option<Effect.Effect<Flags, never, Resources>>
  isFlagsRequired: boolean
  FlagsCodec: Schema.Codec<Flags, any, never, never>
  preservedModel: unknown
  buildId: string | undefined
  preparedHandoff: ResolvedHydrationHandoff<Flags, Resources> | undefined
}>

/** A deferred Flags Effect and host state passed to the renderer for this boot.
 * @experimental The runtime platform contract may change between releases. */
export type RuntimeBoot<Flags, Resources, HostState> = Readonly<{
  resolveFlags: Effect.Effect<Flags, never, Resources>
  rendererState: HostState
}>

/** Host services created separately for each start. Renderer resources release
 * after perpetual fibers and before the renderer's teardown finalizer.
 * @experimental The runtime platform contract may change between releases. */
export type RuntimeHostServices = Readonly<{
  provideRuntime: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>
  releaseRendererResources: Effect.Effect<void>
}>

/** Platform services used by the runtime core. `HostState` carries a boot's
 * hydration state to its renderer without giving the core a platform dependency.
 * @experimental The runtime platform contract may change between releases. */
export type RuntimeHost<Message, HostState = void> = Readonly<{
  isDevelopment: boolean
  isDevToolsDevelopment: () => boolean
  validateRuntime: Effect.Effect<void>
  resolvePreservedModel: Effect.Effect<unknown>
  provideScheduler: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>
  currentUrl: () => Option.Option<Url>
  addNavigationListeners: (
    enqueueMessage: (message: Message) => void,
    routing: RoutingConfig<Message>,
  ) => () => void
  resolveBoot: <Flags, Resources>(
    context: RuntimeBootContext<Flags, Resources>,
  ) => Effect.Effect<RuntimeBoot<Flags, Resources, HostState>>
  makeDrainScheduler: (drain: () => void) => DrainScheduler
  makeRuntimeServices: () => RuntimeHostServices
  makeModelPreserver: <Model>(
    encodeModel: (model: Model) => unknown,
  ) => Effect.Effect<(model: Model) => Effect.Effect<void>, never, Scope.Scope>
  afterInitialRender: Effect.Effect<void>
  connectDevTools: (
    store: DevToolsStore,
    prepareDispatch: PrepareDispatch,
    config: RuntimeDevToolsConfig | undefined,
  ) => Effect.Effect<void, never, Scope.Scope>
}>
