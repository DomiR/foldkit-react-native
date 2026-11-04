import { Effect, Option, Schema, Scope } from 'effect'

import { dispatchRequest, startDevToolsBridge } from './bridge.js'
import type { DevToolsStore } from './store.js'
import { EVENT_CHANNEL, makeViteDevToolsChannel } from './viteChannel.js'

type Hot = NonNullable<ImportMeta['hot']>

/** HMR channel the browser bridge announces connection lifecycle events on. */
export { EVENT_CHANNEL }
export { dispatchRequest }

/**
 * Start the browser WebSocket bridge with the existing Vite HMR transport.
 */
export const startWebSocketBridge = (
  store: DevToolsStore,
  hot: Hot,
  dispatch: (message: unknown) => Effect.Effect<void>,
  maybeMessageSchema: Option.Option<Schema.Codec<any, any>>,
): Effect.Effect<void, never, Scope.Scope> =>
  startDevToolsBridge(
    store,
    makeViteDevToolsChannel(hot),
    () => ({
      url: window.location.href,
      title: document.title,
    }),
    dispatch,
    maybeMessageSchema,
  )
