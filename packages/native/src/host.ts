import { Effect, Function, Option, Schema } from 'effect'
import { type RuntimeHost, startDevToolsBridge } from 'foldkit/runtime-core'
import type { Url } from 'foldkit/url'

import { deepLinkToUrl } from './deepLink'
import type { ResolvedNativeDevTools } from './devTools'
import type { NativeLinking } from './linking'
import { makeNativeWebSocketChannel } from './webSocketChannel'

/** The root URL used when native linking has no parseable launch URL. */
export const rootUrl: Url = {
  protocol: '',
  host: '',
  port: Option.none<string>(),
  pathname: '/',
  search: Option.none<string>(),
  hash: Option.none<string>(),
}

/** Creates native platform services with optional deep-link navigation.
 * A URL event arriving between the launch URL read and listener registration
 * is not delivered by the host. With `expoLinking`, an asynchronously reported
 * launch URL is delivered through the listener when `isLaunchUrlReplayed` is
 * true. Set it to false when starting from a preserved Model. */
export const makeNativeHost = <Message>(
  linking: NativeLinking,
  { isLaunchUrlReplayed }: Readonly<{ isLaunchUrlReplayed: boolean }>,
  maybeDevTools: Option.Option<ResolvedNativeDevTools<Message>> = Option.none(),
): RuntimeHost<Message> => ({
  isDevelopment: false,
  isDevToolsDevelopment: () => Option.isSome(maybeDevTools),
  validateRuntime: Effect.void,
  resolvePreservedModel: Effect.succeed(undefined),
  provideScheduler: Function.identity,
  currentUrl: () =>
    Option.orElse(Option.flatMap(linking.initialUrl(), deepLinkToUrl), () =>
      Option.some(rootUrl),
    ),
  addNavigationListeners: (enqueueMessage, routing) =>
    linking.addUrlListener(
      rawUrl => {
        const maybeUrl = deepLinkToUrl(rawUrl)
        if (Option.isSome(maybeUrl)) {
          enqueueMessage(routing.onUrlChange(maybeUrl.value))
        }
      },
      { isLaunchUrlReplayed },
    ),
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
          : Schema.decodeUnknownEffect(Schema.toType(FlagsCodec))(
              undefined,
            ).pipe(Effect.orDie),
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
  connectDevTools: (store, enqueueMessageEffect) =>
    Option.match(maybeDevTools, {
      onNone: () => Effect.void,
      onSome: ({ url, metadata, maybeMessageSchema }) =>
        startDevToolsBridge(
          store,
          makeNativeWebSocketChannel(url),
          () => metadata,
          enqueueMessageEffect,
          maybeMessageSchema,
        ),
    }),
})
