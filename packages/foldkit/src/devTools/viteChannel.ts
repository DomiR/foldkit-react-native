import { Exit, Function, Schema } from 'effect'

import type { DevToolsChannel, DevToolsChannelCallbacks } from './channel.js'
import {
  DevToolsEnvelope,
  EventFrame,
  RequestFrame,
  ResponseFrame,
} from './protocol.js'

type Hot = NonNullable<ImportMeta['hot']>

const REQUEST_CHANNEL = 'foldkit:devTools:request'
const RESPONSE_CHANNEL = 'foldkit:devTools:response'

/** HMR channel the bridge announces connection lifecycle events on. */
export const EVENT_CHANNEL = 'foldkit:devTools:event'

/**
 * Create the Vite HMR transport for the portable DevTools bridge.
 */
export const makeViteDevToolsChannel = (hot: Hot): DevToolsChannel => {
  const encodeRequestFrame = Schema.encodeUnknownSync(RequestFrame)
  const encodeResponseFrame = Schema.encodeUnknownSync(ResponseFrame)
  const encodeEventFrame = Schema.encodeUnknownSync(EventFrame)
  const decodeRequestFrame = Schema.decodeUnknownExit(RequestFrame)

  let isSubscribed = false
  let isDisposed = false
  let removeListeners: () => void = Function.constVoid

  const send = (envelope: DevToolsEnvelope): void => {
    if (!isSubscribed || isDisposed) {
      return
    }

    try {
      DevToolsEnvelope.match<void>(envelope, {
        Request: ({ frame }) =>
          hot.send(REQUEST_CHANNEL, encodeRequestFrame(frame)),
        Response: ({ frame }) =>
          hot.send(RESPONSE_CHANNEL, encodeResponseFrame(frame)),
        Event: ({ frame }) => hot.send(EVENT_CHANNEL, encodeEventFrame(frame)),
      })
    } catch (error) {
      console.warn('[foldkit:devTools] failed to send HMR frame', error)
    }
  }

  const subscribe = (callbacks: DevToolsChannelCallbacks): (() => void) => {
    if (isSubscribed || isDisposed) {
      return Function.constVoid
    }

    isSubscribed = true

    const handleRequestFrame = (frame: unknown): void => {
      if (!isSubscribed || isDisposed) {
        return
      }

      const decoded = decodeRequestFrame(frame)
      Exit.match(decoded, {
        onFailure: error => {
          console.warn('[foldkit:devTools] malformed request frame', error)
        },
        onSuccess: requestFrame =>
          callbacks.received(DevToolsEnvelope.Request({ frame: requestFrame })),
      })
    }

    const announceOnRestore = ({ persisted }: PageTransitionEvent): void => {
      if (isSubscribed && !isDisposed && persisted) {
        callbacks.opened()
      }
    }

    removeListeners = (): void => {
      hot.off(REQUEST_CHANNEL, handleRequestFrame)
      window.removeEventListener('pageshow', announceOnRestore)
    }

    hot.on(REQUEST_CHANNEL, handleRequestFrame)

    // NOTE: a page-lifecycle event is not a disconnect. `beforeunload` fires
    // for a download-link click and for a navigation the user cancels, and
    // the runtime survives both. The HMR socket tells the relay when a page
    // really goes away, while `pageshow` restores the runtime after the
    // back/forward cache closes that socket.
    window.addEventListener('pageshow', announceOnRestore)

    const dispose = (): void => {
      if (!isSubscribed || isDisposed) {
        return
      }

      // NOTE: the callback remains sendable until the bridge has emitted its
      // terminal EventDisconnected. The HMR disposal callback itself cannot
      // be removed, so the guards above make it inert after teardown.
      callbacks.disposed()
      isDisposed = true
      removeListeners()
    }

    hot.dispose(dispose)
    callbacks.opened()

    let isTornDown = false
    return (): void => {
      if (isTornDown) {
        return
      }
      isTornDown = true
      isSubscribed = false
      removeListeners()
    }
  }

  return { send, subscribe }
}
