import { Exit, Function, Option, Predicate, Schema } from 'effect'
import { DevToolsEnvelope } from 'foldkit/devtools-protocol'
import type { DevToolsChannel } from 'foldkit/runtime-core'

/** The native socket operations used by the relay channel. @internal */
export type NativeWebSocket = Pick<
  WebSocket,
  | 'readyState'
  | 'send'
  | 'close'
  | 'onopen'
  | 'onmessage'
  | 'onerror'
  | 'onclose'
>

const OPEN = 1
const INITIAL_RETRY_MS = 250
const MAX_RETRY_MS = 5000
const MAX_JITTER = 0.2
const CONNECT_TIMEOUT_MS = 10000

/** Creates a lazy reconnecting native transport with no outgoing buffer. @internal */
export const makeNativeWebSocketChannel = (
  url: string,
  createSocket: (url: string) => NativeWebSocket = url => new WebSocket(url),
): DevToolsChannel => {
  const codec = Schema.fromJsonString(DevToolsEnvelope)
  const decode = Schema.decodeUnknownExit(codec)
  const encode = Schema.encodeSync(codec)
  let maybeSocket = Option.none<NativeWebSocket>()
  let teardown = Function.constVoid
  let isWarned = false

  const warnInvalidFrame = (): void => {
    if (!isWarned) {
      isWarned = true
      console.warn(
        '[foldkit/native] Dropped an invalid DevTools frame; expected a text Request envelope.',
      )
    }
  }

  return {
    send: envelope => {
      try {
        if (
          Option.isSome(maybeSocket) &&
          maybeSocket.value.readyState === OPEN
        ) {
          maybeSocket.value.send(encode(envelope))
        }
      } catch {
        return
      }
    },
    subscribe: callbacks => {
      teardown()
      let isDisposed = false
      let retryMs = INITIAL_RETRY_MS
      let maybeTimer = Option.none<ReturnType<typeof setTimeout>>()

      const cancelTimer = (): void => {
        if (Option.isSome(maybeTimer)) {
          clearTimeout(maybeTimer.value)
          maybeTimer = Option.none()
        }
      }

      const closeSocket = (): void => {
        if (Option.isNone(maybeSocket)) {
          return
        }

        const socket = maybeSocket.value
        maybeSocket = Option.none()
        socket.onopen = null
        socket.onmessage = null
        socket.onerror = null
        socket.onclose = null

        try {
          socket.close()
        } catch {
          return
        }
      }

      const scheduleRetry = (): void => {
        cancelTimer()
        closeSocket()

        if (isDisposed) {
          return
        }

        const delay = Math.min(
          MAX_RETRY_MS,
          retryMs * (1 + Math.random() * MAX_JITTER),
        )
        retryMs = Math.min(MAX_RETRY_MS, retryMs * 2)
        maybeTimer = Option.some(setTimeout(connect, delay))
      }

      const connect = (): void => {
        maybeTimer = Option.none()

        if (isDisposed) {
          return
        }

        try {
          const socket = createSocket(url)
          maybeSocket = Option.some(socket)
          const isCurrent = (): boolean =>
            !isDisposed &&
            Option.isSome(maybeSocket) &&
            maybeSocket.value === socket

          socket.onopen = () => {
            if (!isCurrent()) {
              return
            }

            cancelTimer()
            retryMs = INITIAL_RETRY_MS
            callbacks.opened()
          }

          socket.onmessage = event => {
            if (!isCurrent()) {
              return
            }

            if (!Predicate.isString(event.data)) {
              warnInvalidFrame()
              return
            }

            const decoded = decode(event.data)
            if (Exit.isFailure(decoded) || decoded.value._tag !== 'Request') {
              warnInvalidFrame()
              return
            }

            callbacks.received(decoded.value)
          }

          const reconnect = (): void => {
            if (isCurrent()) {
              scheduleRetry()
            }
          }
          socket.onerror = reconnect
          socket.onclose = reconnect
          maybeTimer = Option.some(setTimeout(reconnect, CONNECT_TIMEOUT_MS))
        } catch {
          scheduleRetry()
        }
      }

      const unsubscribe = (): void => {
        if (isDisposed) {
          return
        }

        isDisposed = true
        cancelTimer()
        closeSocket()
      }

      teardown = unsubscribe
      connect()
      return unsubscribe
    },
  }
}
