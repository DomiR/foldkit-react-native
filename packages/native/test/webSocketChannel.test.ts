import { Option } from 'effect'
import {
  DevToolsEnvelope,
  Event,
  EventFrame,
  Request,
  RequestFrame,
  Response,
  ResponseFrame,
} from 'foldkit/devtools-protocol'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { makeNativeWebSocketChannel } from '../src/webSocketChannel'
import {
  FakeWebSocket,
  encodeEnvelope,
  latestSocket,
  makeWebSocketMessageEvent,
} from './nativeFixtures'

const RELAY_URL = 'ws://127.0.0.1:9989/__foldkit/devtools-runtime'
const request = DevToolsEnvelope.Request({
  frame: RequestFrame.make({
    id: 'request-1',
    maybeConnectionId: Option.some('runtime-1'),
    request: Request.RequestGetInit(),
  }),
})
const response = DevToolsEnvelope.Response({
  frame: ResponseFrame.make({
    id: 'request-1',
    response: Response.ResponseResumed(),
  }),
})

const subscribe = () => {
  const createSocket = vi.fn((url: string) => new FakeWebSocket(url))
  const channel = makeNativeWebSocketChannel(RELAY_URL, createSocket)
  const callbacks = { opened: vi.fn(), received: vi.fn(), disposed: vi.fn() }
  return {
    channel,
    callbacks,
    createSocket,
    unsubscribe: channel.subscribe(callbacks),
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(Math, 'random').mockReturnValue(0)
})

describe('native WebSocket channel', () => {
  it('connects only on subscribe and announces every open', () => {
    const createSocket = vi.fn((url: string) => new FakeWebSocket(url))
    const channel = makeNativeWebSocketChannel(RELAY_URL, createSocket)
    expect(createSocket).not.toHaveBeenCalled()
    const callbacks = { opened: vi.fn(), received: vi.fn(), disposed: vi.fn() }
    const unsubscribe = channel.subscribe(callbacks)
    expect(createSocket).toHaveBeenCalledExactlyOnceWith(RELAY_URL)
    expect(callbacks.opened).not.toHaveBeenCalled()
    latestSocket().open()
    expect(callbacks.opened).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
    latestSocket().disconnect()
    vi.advanceTimersByTime(250)
    latestSocket().open()
    expect(callbacks.opened).toHaveBeenCalledTimes(2)
    unsubscribe()
    expect(callbacks.disposed).not.toHaveBeenCalled()
  })

  it('delivers decoded Requests and drops malformed, binary, and reverse-direction frames with one warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { callbacks, unsubscribe } = subscribe()
    const socket = latestSocket()
    socket.open()
    socket.receive(encodeEnvelope(request))
    socket.receive('{')
    socket.receive(new Uint8Array([1, 2]))
    socket.receive(encodeEnvelope(response))
    socket.receive(
      encodeEnvelope(
        DevToolsEnvelope.Event({
          frame: EventFrame.make({
            maybeConnectionId: Option.some('runtime-1'),
            event: Event.EventDisconnected({ connectionId: 'runtime-1' }),
          }),
        }),
      ),
    )
    socket.receive('{"_tag":"Event","frame":{}}')
    expect(callbacks.received).toHaveBeenCalledExactlyOnceWith(request)
    expect(warn).toHaveBeenCalledOnce()
    unsubscribe()
  })

  it('drops disconnected sends and encodes an open send exactly once', () => {
    const { channel, unsubscribe } = subscribe()
    const socket = latestSocket()
    channel.send(response)
    expect(socket.send).not.toHaveBeenCalled()
    socket.open()
    channel.send(response)
    expect(socket.sent).toEqual([encodeEnvelope(response)])
    socket.send.mockImplementationOnce(() => {
      throw new Error('closed during send')
    })
    expect(() => channel.send(response)).not.toThrow()
    socket.disconnect()
    channel.send(response)
    expect(socket.send).toHaveBeenCalledTimes(2)
    unsubscribe()
    channel.send(response)
    expect(socket.send).toHaveBeenCalledTimes(2)
  })

  it('schedules one retry for error plus close and ignores superseded handlers', () => {
    const { callbacks, createSocket, unsubscribe } = subscribe()
    const socket = latestSocket()
    const staleOpen = socket.onopen
    const staleMessage = socket.onmessage
    const staleClose = socket.onclose
    socket.fail()
    staleClose?.(new globalThis.Event('close'))
    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(249)
    expect(createSocket).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    expect(createSocket).toHaveBeenCalledTimes(2)
    staleOpen?.()
    staleMessage?.(makeWebSocketMessageEvent(encodeEnvelope(request)))
    staleClose?.(new globalThis.Event('close'))
    expect(callbacks.opened).not.toHaveBeenCalled()
    expect(callbacks.received).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(1)
    latestSocket().open()
    expect(vi.getTimerCount()).toBe(0)
    unsubscribe()
  })

  it('doubles retries up to the cap and resets after a successful open', () => {
    const { createSocket, unsubscribe } = subscribe()
    const delays = [250, 500, 1000, 2000, 4000, 5000, 5000]
    for (const delay of delays) {
      const attempts = createSocket.mock.calls.length
      latestSocket().fail()
      vi.advanceTimersByTime(delay - 1)
      expect(createSocket).toHaveBeenCalledTimes(attempts)
      vi.advanceTimersByTime(1)
      expect(createSocket).toHaveBeenCalledTimes(attempts + 1)
    }
    latestSocket().open()
    latestSocket().disconnect()
    const attempts = createSocket.mock.calls.length
    vi.advanceTimersByTime(250)
    expect(createSocket).toHaveBeenCalledTimes(attempts + 1)
    unsubscribe()
  })

  it('adds jitter within twenty percent of the initial delay', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const { createSocket, unsubscribe } = subscribe()
    latestSocket().fail()
    vi.advanceTimersByTime(274)
    expect(createSocket).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    expect(createSocket).toHaveBeenCalledTimes(2)
    unsubscribe()
  })

  it('retries construction failures and timed out connections', () => {
    const createSocket = vi
      .fn((url: string) => new FakeWebSocket(url))
      .mockImplementationOnce(() => {
        throw new Error('unavailable')
      })
    const channel = makeNativeWebSocketChannel(RELAY_URL, createSocket)
    const unsubscribe = channel.subscribe({
      opened: vi.fn(),
      received: vi.fn(),
      disposed: vi.fn(),
    })
    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(250)
    const socket = latestSocket()
    vi.advanceTimersByTime(10000)
    expect(socket.close).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(500)
    expect(createSocket).toHaveBeenCalledTimes(3)
    unsubscribe()
  })

  it.each(['connecting', 'waiting', 'open'])('tears down while %s', phase => {
    const { channel, callbacks, createSocket, unsubscribe } = subscribe()
    const socket = latestSocket()
    const staleOpen = socket.onopen
    const staleClose = socket.onclose
    if (phase === 'open') {
      socket.open()
    }
    if (phase === 'waiting') {
      socket.fail()
    }
    unsubscribe()
    unsubscribe()
    staleOpen?.()
    staleClose?.(new globalThis.Event('close'))
    channel.send(response)
    vi.advanceTimersByTime(60000)
    expect(createSocket).toHaveBeenCalledOnce()
    expect(socket.close).toHaveBeenCalledOnce()
    expect(socket.onopen).toBeNull()
    expect(socket.onmessage).toBeNull()
    expect(socket.onerror).toBeNull()
    expect(socket.onclose).toBeNull()
    expect(socket.send).not.toHaveBeenCalled()
    expect(callbacks.disposed).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})
