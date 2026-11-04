import { Effect, Exit, Option, Result, Schema, Scope } from 'effect'
import { describe, expect, it } from 'vitest'

import { defineMessageUnion } from '../message/index.js'
import {
  type PrepareDispatch,
  dispatchRequest,
  startDevToolsBridge,
} from './bridge.js'
import type { DevToolsChannel, DevToolsChannelCallbacks } from './channel.js'
import { DevToolsEnvelope, Request } from './protocol.js'
import { type Bridge, createDevToolsStore } from './store.js'

const CounterModel = Schema.Struct({ count: Schema.Number })
type CounterModel = typeof CounterModel.Type

const CounterMessage = defineMessageUnion({
  ClickedIncrement: {},
  ClickedDecrement: {},
})
type CounterMessage = typeof CounterMessage.Type

const initialModel = CounterModel.make({ count: 0 })
const clickedIncrement = CounterMessage.ClickedIncrement()

const isCounterMessage = Schema.is(CounterMessage)

const prepareWith =
  (
    dispatch: (message: CounterMessage) => Effect.Effect<void>,
  ): PrepareDispatch =>
  message =>
    isCounterMessage(message)
      ? Result.succeed(
          Effect.as(dispatch(message), Result.succeed(Option.some(1))),
        )
      : Result.fail('Not a CounterMessage')

const run = <A>(effect: Effect.Effect<A>): A => Effect.runSync(effect)

const makeBridge = (): Bridge => ({
  replay: model => model,
  render: () => Effect.void,
  markRenderPending: Effect.void,
})

const makeChannel = () => {
  let maybeCallbacks: DevToolsChannelCallbacks | undefined
  let isUnsubscribed = false
  const sent: Array<DevToolsEnvelope> = []

  const channel: DevToolsChannel = {
    send: envelope => {
      if (!isUnsubscribed) {
        sent.push(envelope)
      }
    },
    subscribe: callbacks => {
      maybeCallbacks = callbacks
      callbacks.opened()
      return () => {
        isUnsubscribed = true
        maybeCallbacks = undefined
      }
    },
  }

  return {
    channel,
    sent,
    open: (): void => maybeCallbacks?.opened(),
    receive: (envelope: DevToolsEnvelope): void =>
      maybeCallbacks?.received(envelope),
    dispose: (): void => maybeCallbacks?.disposed(),
  }
}

const getConnectionId = (sent: ReadonlyArray<DevToolsEnvelope>): string => {
  const connected = sent.find(
    (envelope): envelope is Extract<DevToolsEnvelope, { _tag: 'Event' }> =>
      envelope._tag === 'Event' &&
      envelope.frame.event._tag === 'EventConnected',
  )
  if (
    connected === undefined ||
    connected.frame.event._tag !== 'EventConnected'
  ) {
    throw new Error('Expected EventConnected')
  }
  return connected.frame.event.runtime.connectionId
}

const getResponse = (
  sent: ReadonlyArray<DevToolsEnvelope>,
  id: string,
): Extract<DevToolsEnvelope, { _tag: 'Response' }> | undefined =>
  sent.find(
    (envelope): envelope is Extract<DevToolsEnvelope, { _tag: 'Response' }> =>
      envelope._tag === 'Response' && envelope.frame.id === id,
  )

const makeStore = () => {
  const store = run(createDevToolsStore(makeBridge(), { keyframeInterval: 1 }))
  run(store.recordInit(initialModel, []))
  run(
    store.recordMessage(
      clickedIncrement,
      initialModel,
      CounterModel.make({ count: 1 }),
      [],
      true,
    ),
  )
  return store
}

const makeRequest = (
  id: string,
  connectionId: string,
  request: Request,
): DevToolsEnvelope =>
  DevToolsEnvelope.Request({
    frame: {
      id,
      maybeConnectionId: Option.some(connectionId),
      request,
    },
  })

describe('startDevToolsBridge', () => {
  it('announces each opening with one stable connection id and answers store requests', async () => {
    const fakeChannel = makeChannel()
    const store = makeStore()
    const scope = run(Scope.make())

    run(
      Effect.provideService(
        startDevToolsBridge(
          store,
          fakeChannel.channel,
          () => ({ url: 'native://counter', title: 'Counter' }),
          Option.none(),
          prepareWith(() => Effect.void),
        ),
        Scope.Scope,
        scope,
      ),
    )

    const connectionId = getConnectionId(fakeChannel.sent)
    fakeChannel.open()
    expect(
      fakeChannel.sent.filter(
        envelope =>
          envelope._tag === 'Event' &&
          envelope.frame.event._tag === 'EventConnected',
      ),
    ).toHaveLength(2)
    expect(getConnectionId(fakeChannel.sent)).toBe(connectionId)

    fakeChannel.receive(
      makeRequest('init', connectionId, Request.RequestGetInit()),
    )
    fakeChannel.receive(
      makeRequest(
        'messages',
        connectionId,
        Request.RequestListMessages({
          limit: 10,
          maybeSinceIndex: Option.none(),
          maybeChangedPathsMatch: Option.none(),
          fromEnd: false,
        }),
      ),
    )
    fakeChannel.receive(
      makeRequest(
        'model',
        connectionId,
        Request.RequestGetModel({
          maybePath: Option.none(),
          expand: true,
        }),
      ),
    )
    fakeChannel.receive(
      makeRequest('state', connectionId, Request.RequestGetRuntimeState()),
    )
    await Promise.resolve()

    expect(getResponse(fakeChannel.sent, 'init')?.frame.response._tag).toBe(
      'ResponseInit',
    )
    expect(getResponse(fakeChannel.sent, 'messages')?.frame.response._tag).toBe(
      'ResponseMessages',
    )
    expect(getResponse(fakeChannel.sent, 'model')?.frame.response._tag).toBe(
      'ResponseModel',
    )
    expect(getResponse(fakeChannel.sent, 'state')?.frame.response._tag).toBe(
      'ResponseRuntimeState',
    )

    fakeChannel.receive(
      makeRequest('ignored', 'another-runtime', Request.RequestGetInit()),
    )
    await Promise.resolve()
    expect(getResponse(fakeChannel.sent, 'ignored')).toBeUndefined()

    await run(Scope.close(scope, Exit.void))
    expect(
      fakeChannel.sent.filter(
        envelope =>
          envelope._tag === 'Event' &&
          envelope.frame.event._tag === 'EventDisconnected',
      ),
    ).toHaveLength(1)
  })

  it('validates dispatch payloads and batches before dispatching', async () => {
    const fakeChannel = makeChannel()
    const store = makeStore()
    const scope = run(Scope.make())
    const dispatched: Array<CounterMessage> = []
    const dispatch = (message: CounterMessage) =>
      Effect.sync(() => {
        dispatched.push(message)
      })

    run(
      Effect.provideService(
        startDevToolsBridge(
          store,
          fakeChannel.channel,
          () => ({ url: 'native://counter', title: 'Counter' }),
          Option.some(CounterMessage),
          prepareWith(dispatch),
        ),
        Scope.Scope,
        scope,
      ),
    )

    const connectionId = getConnectionId(fakeChannel.sent)
    fakeChannel.receive(
      makeRequest(
        'valid',
        connectionId,
        Request.RequestDispatchMessage({
          message: { _tag: 'ClickedIncrement' },
        }),
      ),
    )
    fakeChannel.receive(
      makeRequest(
        'batch',
        connectionId,
        Request.RequestDispatchMessages({
          messages: [
            { _tag: 'ClickedIncrement' },
            { _tag: 'ClickedDecrement' },
          ],
        }),
      ),
    )
    await Promise.resolve()

    expect(dispatched).toEqual([
      CounterMessage.ClickedIncrement(),
      CounterMessage.ClickedIncrement(),
      CounterMessage.ClickedDecrement(),
    ])
    expect(getResponse(fakeChannel.sent, 'valid')?.frame.response._tag).toBe(
      'ResponseDispatched',
    )
    expect(getResponse(fakeChannel.sent, 'batch')?.frame.response._tag).toBe(
      'ResponseDispatchedBatch',
    )

    await run(Scope.close(scope, Exit.void))
  })

  it('suppresses a response after scope close', async () => {
    const fakeChannel = makeChannel()
    const store = makeStore()
    const scope = run(Scope.make())
    let resolveDispatch: (() => void) | undefined
    const dispatch = (message: CounterMessage) =>
      Effect.promise(
        () =>
          new Promise<void>(resolve => {
            resolveDispatch = () => resolve()
          }),
      ).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            void message
          }),
        ),
      )

    run(
      Effect.provideService(
        startDevToolsBridge(
          store,
          fakeChannel.channel,
          () => ({ url: 'native://counter', title: 'Counter' }),
          Option.some(CounterMessage),
          prepareWith(dispatch),
        ),
        Scope.Scope,
        scope,
      ),
    )

    const connectionId = getConnectionId(fakeChannel.sent)
    fakeChannel.receive(
      makeRequest(
        'valid',
        connectionId,
        Request.RequestDispatchMessage({
          message: { _tag: 'ClickedIncrement' },
        }),
      ),
    )
    await Promise.resolve()
    await run(Scope.close(scope, Exit.void))
    resolveDispatch?.()
    await Promise.resolve()
    expect(getResponse(fakeChannel.sent, 'valid')).toBeUndefined()

    const invalid = await Effect.runPromise(
      dispatchRequest(
        store,
        Option.some(Schema.toCodecJson(CounterMessage)),
        Option.none(),
        Request.RequestDispatchMessage({ message: { _tag: 'Unknown' } }),
        prepareWith(() => Effect.void),
      ),
    )
    expect(invalid._tag).toBe('ResponseError')
    const withoutSchema = await Effect.runPromise(
      dispatchRequest(
        store,
        Option.none(),
        Option.none(),
        Request.RequestDispatchMessage({
          message: { _tag: 'ClickedIncrement' },
        }),
        prepareWith(() => Effect.void),
      ),
    )
    expect(withoutSchema._tag).toBe('ResponseError')
  })
})
