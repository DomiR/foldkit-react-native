import { Effect, Function, Option, Schema } from 'effect'
import type { RuntimeHost } from 'foldkit/runtime-core'

/** Creates native platform services without routing or development reloads. */
export const makeNativeHost = <Message>(): RuntimeHost<Message> => ({
  isDevelopment: false,
  isDevToolsDevelopment: () => false,
  validateRuntime: Effect.void,
  resolvePreservedModel: Effect.succeed(undefined),
  provideScheduler: Function.identity,
  currentUrl: Option.none,
  addNavigationListeners: () => Function.constVoid,
  resolveBoot: ({
    bootMode,
    bootFlags,
    configuredFlags,
    isFlagsRequired,
    FlagsCodec,
    provideResources,
  }) => {
    if (bootMode === 'Hydrate') {
      return Effect.die(
        new Error('[foldkit/native] Hydration is not supported.'),
      )
    }

    const maybeFlags = Option.orElse(
      Option.fromNullishOr(bootFlags),
      () => configuredFlags,
    )
    const resolveFlags = Option.match(maybeFlags, {
      onNone: () =>
        isFlagsRequired
          ? Effect.die(
              new Error('[foldkit/native] This program requires Flags.'),
            )
          : Effect.sync(() =>
              Schema.decodeUnknownSync(Schema.toType(FlagsCodec))(undefined),
            ),
      onSome: provideResources,
    })

    return Effect.succeed({ resolveFlags, rendererState: undefined })
  },
  makeRuntimeServices: () => ({
    provideRuntime: Function.identity,
    releaseRendererResources: Effect.void,
  }),
  makeDrainScheduler: drain => {
    let maybeTimeout = Option.none<ReturnType<typeof setTimeout>>()

    return {
      schedule: () => {
        maybeTimeout = Option.some(
          setTimeout(() => {
            maybeTimeout = Option.none()
            drain()
          }, 0),
        )
      },
      dispose: () => {
        if (Option.isSome(maybeTimeout)) {
          clearTimeout(maybeTimeout.value)
          maybeTimeout = Option.none()
        }
      },
    }
  },
  makeModelPreserver: () => Effect.succeed(() => Effect.void),
  afterInitialRender: Effect.void,
  connectDevTools: () => Effect.void,
})
