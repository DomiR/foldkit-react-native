import { Function, Option, Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import {
  DevToolsEnvelope,
  Event,
  EventFrame,
  Request,
  RequestFrame,
  Response,
  ResponseFrame,
} from './protocol.js'
import { EVENT_CHANNEL, makeViteDevToolsChannel } from './viteChannel.js'

type SentFrame = Readonly<{
  channel: string
  payload: unknown
}>

type Hot = NonNullable<ImportMeta['hot']>
type HotEventHandler = Parameters<Hot['on']>[1]

const makeHot = () => {
  let maybeRequestHandler: HotEventHandler | undefined
  let maybeDispose: ((data: unknown) => void) | undefined
  const sent: Array<SentFrame> = []

  const hot: Hot = {
    data: {},
    accept: Function.constVoid,
    acceptExports: Function.constVoid,
    dispose: callback => {
      maybeDispose = callback
    },
    prune: Function.constVoid,
    invalidate: Function.constVoid,
    on: (channel, callback) => {
      if (channel === 'foldkit:devTools:request') {
        maybeRequestHandler = callback
      }
    },
    off: (channel, callback) => {
      if (
        channel === 'foldkit:devTools:request' &&
        callback === maybeRequestHandler
      ) {
        maybeRequestHandler = undefined
      }
    },
    send: (channel, payload) => {
      sent.push({ channel, payload })
    },
  }

  return {
    hot,
    sent,
    request: (frame: unknown): void => maybeRequestHandler?.(frame),
    dispose: (): void => maybeDispose?.({}),
  }
}

const dispatchPageShow = (persisted: boolean): void => {
  const event = new globalThis.Event('pageshow')
  Object.defineProperty(event, 'persisted', { value: persisted })
  window.dispatchEvent(event)
}

describe('makeViteDevToolsChannel', () => {
  it('encodes outgoing envelopes on the matching HMR channels', () => {
    const { hot, sent } = makeHot()
    const channel = makeViteDevToolsChannel(hot)
    const unsubscribe = channel.subscribe({
      opened: Function.constVoid,
      received: Function.constVoid,
      disposed: Function.constVoid,
    })

    channel.send(
      DevToolsEnvelope.Request({
        frame: {
          id: 'request-1',
          maybeConnectionId: Option.none(),
          request: Request.RequestGetInit(),
        },
      }),
    )
    channel.send(
      DevToolsEnvelope.Response({
        frame: {
          id: 'request-1',
          response: Response.ResponseError({ reason: 'failed' }),
        },
      }),
    )
    channel.send(
      DevToolsEnvelope.Event({
        frame: {
          maybeConnectionId: Option.some('runtime-1'),
          event: Event.EventDisconnected({ connectionId: 'runtime-1' }),
        },
      }),
    )

    expect(sent.map(({ channel }) => channel)).toEqual([
      'foldkit:devTools:request',
      'foldkit:devTools:response',
      EVENT_CHANNEL,
    ])
    expect(
      Schema.decodeUnknownSync(RequestFrame)(
        sent.find(({ channel }) => channel === 'foldkit:devTools:request')
          ?.payload,
      ),
    ).toEqual({
      id: 'request-1',
      maybeConnectionId: Option.none(),
      request: Request.RequestGetInit(),
    })
    expect(
      Schema.decodeUnknownSync(ResponseFrame)(
        sent.find(({ channel }) => channel === 'foldkit:devTools:response')
          ?.payload,
      ).response._tag,
    ).toBe('ResponseError')
    expect(
      Schema.decodeUnknownSync(EventFrame)(
        sent.find(({ channel }) => channel === EVENT_CHANNEL)?.payload,
      ).event._tag,
    ).toBe('EventDisconnected')

    unsubscribe()
  })

  it('announces restore, disposes, and removes listeners during teardown', () => {
    const { hot, request, dispose } = makeHot()
    let openedCount = 0
    let disposedCount = 0
    const received: Array<DevToolsEnvelope> = []
    const channel = makeViteDevToolsChannel(hot)
    const unsubscribe = channel.subscribe({
      opened: () => {
        openedCount += 1
      },
      received: envelope => {
        received.push(envelope)
      },
      disposed: () => {
        disposedCount += 1
      },
    })

    expect(openedCount).toBe(1)
    dispatchPageShow(false)
    dispatchPageShow(true)
    expect(openedCount).toBe(2)

    request(
      Schema.encodeUnknownSync(RequestFrame)({
        id: 'request-1',
        maybeConnectionId: Option.some('runtime-1'),
        request: Request.RequestGetInit(),
      }),
    )
    expect(received).toHaveLength(1)

    dispose()
    expect(disposedCount).toBe(1)
    dispatchPageShow(true)
    request({})
    expect(openedCount).toBe(2)
    expect(received).toHaveLength(1)

    unsubscribe()
    unsubscribe()
    dispose()
    expect(disposedCount).toBe(1)
  })
})
