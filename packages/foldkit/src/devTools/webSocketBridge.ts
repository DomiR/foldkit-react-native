import type { Option, Schema, Scope } from 'effect'
import type { Effect } from 'effect'

import {
  type PrepareDispatch,
  dispatchRequest,
  startDevToolsBridge,
} from './bridge.js'
import type { DevToolsStore } from './store.js'
import { EVENT_CHANNEL, makeViteDevToolsChannel } from './viteChannel.js'

type Hot = NonNullable<ImportMeta['hot']>

export type { PrepareDispatch, PreparedDispatch } from './bridge.js'

/** HMR channel the browser bridge announces connection lifecycle events on. */
export { EVENT_CHANNEL }
export { dispatchRequest }

/**
 * Start the browser DevTools bridge over the Vite HMR WebSocket.
 * `prepareDispatch` admits a decoded Message for its current runtime
 * occurrence. Callers check that `import.meta.hot` is defined first.
 */
export const startWebSocketBridge = (
  store: DevToolsStore,
  hot: Hot,
  maybeMessageSchema: Option.Option<Schema.Codec<any, any, never, never>>,
  prepareDispatch: PrepareDispatch,
): Effect.Effect<void, never, Scope.Scope> =>
  startDevToolsBridge(
    store,
    makeViteDevToolsChannel(hot),
    () => ({
      url: window.location.href,
      title: document.title,
    }),
    maybeMessageSchema,
    prepareDispatch,
  )
