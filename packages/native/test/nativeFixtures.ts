import { Array, Option, Predicate, Schema } from 'effect'
import { DevToolsEnvelope } from 'foldkit/devtools-protocol'
import { vi } from 'vitest'

import type { NativeWebSocket } from '../src/webSocketChannel'

const CONNECTING = 0
const OPEN = 1
const CLOSED = 3
const FRAME_MS = 16

export const makeWebSocketMessageEvent = (
  data: unknown,
): WebSocketMessageEvent =>
  Object.assign(new globalThis.Event('message'), { data })

export class FakeWebSocket implements NativeWebSocket {
  static sockets: Array<FakeWebSocket> = []
  readonly url: string
  readyState: NativeWebSocket['readyState'] = CONNECTING
  onopen: NativeWebSocket['onopen'] = null
  onmessage: NativeWebSocket['onmessage'] = null
  onerror: NativeWebSocket['onerror'] = null
  onclose: NativeWebSocket['onclose'] = null
  readonly sent: Array<string> = []
  send = vi.fn<NativeWebSocket['send']>(data => {
    if (Predicate.isString(data)) {
      this.sent.push(data)
    }
  })
  close = vi.fn<NativeWebSocket['close']>(() => {
    this.readyState = CLOSED
  })

  constructor(url: string) {
    this.url = url
    FakeWebSocket.sockets.push(this)
  }

  open(): void {
    this.readyState = OPEN
    this.onopen?.()
  }

  receive(data: unknown): void {
    this.onmessage?.(makeWebSocketMessageEvent(data))
  }

  disconnect(): void {
    this.readyState = CLOSED
    const event: WebSocketCloseEvent = new globalThis.Event('close')
    this.onclose?.(event)
  }

  fail(): void {
    const event: WebSocketErrorEvent = Object.assign(
      new globalThis.Event('error'),
      { message: 'Socket failed' },
    )
    this.onerror?.(event)
  }
}

export const latestSocket = (): FakeWebSocket =>
  Option.getOrThrow(Array.last(FakeWebSocket.sockets))

export const encodeEnvelope = Schema.encodeSync(
  Schema.fromJsonString(DevToolsEnvelope),
)
export const decodeEnvelope = Schema.decodeUnknownSync(
  Schema.fromJsonString(DevToolsEnvelope),
)

export const makeAnimationFrames = () => {
  const frames = new Map<number, (timestamp: number) => void>()
  let nextFrameId = 0

  vi.stubGlobal(
    'requestAnimationFrame',
    (callback: (timestamp: number) => void) => {
      const frameId = ++nextFrameId
      frames.set(frameId, callback)
      return frameId
    },
  )
  vi.stubGlobal('cancelAnimationFrame', (frameId: number) => {
    frames.delete(frameId)
  })

  const flush = (): void => {
    const pendingFrames = Array.fromIterable(frames.entries())
    frames.clear()
    for (const [frameId, callback] of pendingFrames) {
      callback(frameId * FRAME_MS)
    }
  }

  return { flush, pending: () => frames.size }
}
