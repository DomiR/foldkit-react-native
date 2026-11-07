import { Effect, Layer, Option, Schema } from 'effect'

import type { AnyBlock } from '../block/definition.js'
import { lowerBlock } from '../block/lowering.js'
import { qualifyLayer } from '../block/scope.js'
import { selectLayer } from '../experimental/contracted/runtime.js'
import type { RoutingConfig } from './browserListeners.js'
import type { DevToolsConfig, RuntimeDevToolsConfig } from './devToolsConfig.js'
import type {
  RuntimeCrashConfig,
  RuntimeHost,
  RuntimeRenderer,
} from './platform.js'
import {
  type RootBlock,
  assertCompletedRoot,
  resolveProgramRoot,
  rootConstructionOf,
} from './rootBlock.js'
import { makeRuntime, runtimeInternals } from './runtime.js'

/** Configuration for a platform runtime that runs a root Block.
 * @experimental The runtime platform contract may change between releases. */
export type BlockRuntimeConfig<HostState> = Readonly<{
  runtimeId: string
  /** A completed root Block, or an original Block paired with `layer`. */
  block: object
  /** The ordinary Layer that completes an original root Block. */
  layer?: Layer.Layer<any, any, any>
  /** Services for the Block's Commands, Subscriptions, ManagedResources, and
   * Layer construction, such as storage or a platform animation host. */
  applicationLayer?: Layer.Layer<any, any, never>
  routing?: RoutingConfig<any>
  crash?: RuntimeCrashConfig<any, any>
  devTools?: DevToolsConfig
  renderer: RuntimeRenderer<any, any, HostState>
  host: RuntimeHost<any, HostState>
  /** Receives the completed root Block before its first render, for example
   * to attach it to the builder of a strict view with child Blocks. */
  onComplete?: (block: object) => void
}>

/** A runtime program whose scoped `start` Effect runs the Block graph.
 * @experimental The runtime platform contract may change between releases. */
export type BlockRuntimeProgram = Readonly<{
  runtimeId: string
  start: (preservedModel?: unknown) => Effect.Effect<void>
}>

const identityRoot = (block: RootBlock): RootBlock => block

const toRuntimeDevTools = (
  devTools: DevToolsConfig | undefined,
  dispatchSchema: Schema.Codec<any, any, never, never>,
): RuntimeDevToolsConfig | undefined =>
  devTools === undefined || devTools === false || devTools.dispatch !== true
    ? devTools
    : { ...devTools, dispatchSchema }

const startCompletedBlock = <HostState>(
  block: AnyBlock,
  config: BlockRuntimeConfig<HostState>,
  preservedModel: unknown,
  memoMap: Layer.MemoMap | undefined,
): Effect.Effect<void> => {
  config.onComplete?.(block)
  const lowered = lowerBlock(block)
  const devTools = toRuntimeDevTools(config.devTools, block.Message)
  const program = makeRuntime({
    runtimeId: config.runtimeId,
    kind: 'Element',
    ports: undefined,
    Model: lowered.Model,
    Flags: Schema.Void,
    configuredFlags: Option.none(),
    isFlagsRequired: false,
    init:
      config.routing === undefined
        ? () => lowered.init()
        : (_flags: void, url?: unknown) => lowered.init(url),
    update: lowered.update,
    subscriptions: lowered.subscriptions,
    managedResources: lowered.managedResources,
    ...(config.routing === undefined ? {} : { routing: config.routing }),
    ...(config.crash === undefined ? {} : { crash: config.crash }),
    ...(devTools === undefined ? {} : { devTools }),
    renderer: config.renderer,
    host: config.host,
  })
  const internals = runtimeInternals.get(program)

  if (internals === undefined) {
    return Effect.die(
      new Error('[foldkit] A Block runtime must complete a runtime program.'),
    )
  }

  internals.compositionRoot = block
  const providers = Layer.provideMerge(
    block.EffectsLayer,
    config.applicationLayer ?? Layer.empty,
  )

  return internals.startWithApplicationLayer(
    Option.none(),
    preservedModel,
    'Fresh',
    undefined,
    undefined,
    qualifyLayer(block.owner.id, providers),
    undefined,
    memoMap,
  )
}

/** Runs a root Block with platform-supplied rendering and services. An
 * original Block paired with `layer` is completed inside `start`, so its Layer
 * construction runs in the runtime's Scope.
 * @experimental The runtime platform contract may change between releases. */
export const makeBlockRuntime = <HostState>(
  config: BlockRuntimeConfig<HostState>,
): BlockRuntimeProgram => {
  // NOTE: selectLayer and assertCompletedRoot validate the Block at runtime
  // and throw for any value that is not an original or completed root Block.
  const root: RootBlock =
    config.layer === undefined
      ? Reflect.apply(identityRoot, undefined, [config.block])
      : Reflect.apply(selectLayer, undefined, [config.block, config.layer])

  if (rootConstructionOf(root) === undefined) {
    assertCompletedRoot(root)

    return {
      runtimeId: config.runtimeId,
      start: preservedModel =>
        startCompletedBlock(root, config, preservedModel, undefined),
    }
  }

  return {
    runtimeId: config.runtimeId,
    start: preservedModel =>
      Effect.scoped(
        Effect.gen(function* () {
          const scope = yield* Effect.scope
          const memoMap = yield* Layer.makeMemoMap
          const services = yield* Layer.buildWithMemoMap(
            config.applicationLayer ?? Layer.empty,
            memoMap,
            scope,
          ).pipe(Effect.orDie)
          const block = yield* resolveProgramRoot(root, memoMap).pipe(
            Effect.provideContext(services),
            Effect.orDie,
          )

          return yield* startCompletedBlock(
            block,
            config,
            preservedModel,
            memoMap,
          )
        }),
      ),
  }
}
