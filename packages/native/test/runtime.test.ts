import { Array, Effect, Number, Option, Schema } from 'effect'
import * as Linking from 'expo-linking'
import { Command, type Update } from 'foldkit'
import {
  DevToolsEnvelope,
  Request,
  RequestFrame,
  type Response,
} from 'foldkit/devtools-protocol'
import { defineMessageUnion } from 'foldkit/message'
import { UrlRequest } from 'foldkit/navigation'
import { modifyFields } from 'foldkit/struct'
import { Url } from 'foldkit/url'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { NativeBuilder } from '../src/builder'
import {
  type NativeProgram,
  type NativeProgramConfig,
  makeNativeProgram,
} from '../src/runtime'
import {
  FakeWebSocket,
  decodeEnvelope,
  encodeEnvelope,
  latestSocket,
  makeAnimationFrames,
} from './nativeFixtures'

const Model = Schema.Struct({ count: Schema.Number })
type Model = typeof Model.Type
const Message = defineMessageUnion({
  ClickedIncrement: {},
  ClickedCrash: {},
  CompletedWaitForIncrement: {},
  ChangedUrl: { url: Url },
  ClickedLink: { request: UrlRequest },
})
type Message = typeof Message.Type
const INIT_INDEX = -1
const BACKGROUND_DELAY_MS = 1000
const DRAIN_TURN_MS = 1
const BOOT_TIMEOUT_MS = 100

const WaitForIncrement = Command.define('WaitForIncrement', {
  messages: [Message.CompletedWaitForIncrement],
  execute: Effect.as(
    Effect.sleep(BACKGROUND_DELAY_MS),
    Message.CompletedWaitForIncrement(),
  ),
})

const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message>>(message, {
    ClickedIncrement: () => ({
      model: modifyFields(model, { count: Number.increment }),
    }),
    CompletedWaitForIncrement: () => ({
      model: modifyFields(model, { count: Number.increment }),
    }),
    ClickedCrash: () => {
      throw new Error('Counter crashed')
    },
    ChangedUrl: () => ({ model }),
    ClickedLink: () => ({ model }),
  })

const view = (model: Model, h: NativeBuilder<Message>) =>
  h.button([h.OnClick(Message.ClickedIncrement())], [`${model.count}`])

const readConnectionId = (socket: FakeWebSocket): string => {
  for (const wire of socket.sent) {
    const envelope = decodeEnvelope(wire)
    if (
      envelope._tag === 'Event' &&
      envelope.frame.event._tag === 'EventConnected'
    ) {
      return envelope.frame.event.runtime.connectionId
    }
  }
  throw new Error('The runtime did not announce a connection.')
}

const expectCount = (
  program: NativeProgram<Model, Message>,
  count: number,
): void => {
  expect(program.getSnapshot()).toMatchObject({
    _tag: 'Element',
    children: [`${count}`],
  })
}

const makeRuntimeFixture = () => {
  const animationFrames = makeAnimationFrames()
  const programs: Array<NativeProgram<Model, Message>> = []
  let nextRequestId = 0

  const flushMessages = () => vi.advanceTimersByTimeAsync(DRAIN_TURN_MS)

  const startProgram = async (
    config: NativeProgramConfig<Model, Message>,
    expectedCount = 0,
  ) => {
    const program = makeNativeProgram(config)
    programs.push(program)

    await vi.waitFor(
      () => {
        expect(program.getModel()).toEqual({ count: expectedCount })
        expectCount(program, expectedCount)
      },
      { interval: DRAIN_TURN_MS, timeout: BOOT_TIMEOUT_MS },
    )
    await flushMessages()
    return program
  }

  const createProgram = (overrides: Partial<NativeProgramConfig<Model, Message>> = {}) =>
    startProgram({
      Model,
      init: () => ({ model: Model.make({ count: 0 }) }),
      update,
      view,
      devTools: { Message },
      ...overrides,
    })

  const connect = async (): Promise<FakeWebSocket> => {
    await flushMessages()
    const socket = latestSocket()
    socket.open()
    await flushMessages()
    readConnectionId(socket)
    return socket
  }

  const sendRequest = async (
    socket: FakeWebSocket,
    request: Request,
  ): Promise<Response> => {
    const id = `request-${++nextRequestId}`
    socket.receive(
      encodeEnvelope(
        DevToolsEnvelope.Request({
          frame: RequestFrame.make({
            id,
            maybeConnectionId: Option.some(readConnectionId(socket)),
            request,
          }),
        }),
      ),
    )
    await flushMessages()
    const envelope = Option.getOrThrow(
      Array.findFirst(
        socket.sent.map(wire => decodeEnvelope(wire)),
        envelope => envelope._tag === 'Response' && envelope.frame.id === id,
      ),
    )
    if (envelope._tag !== 'Response') {
      throw new Error('Expected a response envelope.')
    }
    return envelope.frame.response
  }

  const flushAnimationFrames = async (): Promise<void> => {
    await flushMessages()
    animationFrames.flush()
    await flushMessages()
  }

  const dispose = async (): Promise<void> => {
    for (const program of programs) {
      program.dispose()
    }

    await flushMessages()
  }

  return {
    connect,
    createProgram,
    dispose,
    flushAnimationFrames,
    flushMessages,
    pendingAnimationFrames: animationFrames.pending,
    sendRequest,
    startProgram,
  }
}

const testRuntime = (
  name: string,
  run: (native: ReturnType<typeof makeRuntimeFixture>) => Promise<void>,
): void => {
  it(name, async () => {
    const native = makeRuntimeFixture()

    try {
      await run(native)
    } finally {
      await native.dispose()
    }
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('__DEV__', true)
  vi.stubGlobal('WebSocket', FakeWebSocket)
  vi.spyOn(Math, 'random').mockReturnValue(0)
})

describe('native routing across Fast Refresh', () => {
  beforeEach(() => {
    vi.mocked(Linking.getLinkingURL).mockReturnValue(
      'foldkit://examples/contacts',
    )
    vi.mocked(Linking.getInitialURL).mockResolvedValue(
      'foldkit://examples/counter',
    )
  })

  const makeRoutedConfig = () => ({
    id: 'native-routing-test',
    Model,
    init: vi.fn((_url: Url) => ({ model: Model.make({ count: 0 }) })),
    update,
    view,
    routing: {
      onUrlChange: vi.fn((url: Url) => Message.ChangedUrl({ url })),
      onUrlRequest: (request: UrlRequest) => Message.ClickedLink({ request }),
    },
  })

  testRuntime(
    'delivers the asynchronous launch URL once on cold start',
    async native => {
      const config = makeRoutedConfig()
      await native.startProgram(config)
      await native.flushMessages()

      expect(config.init).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ pathname: '/examples/contacts' }),
      )
      expect(config.routing.onUrlChange).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ pathname: '/examples/counter' }),
      )
      expect(Linking.getInitialURL).toHaveBeenCalledOnce()
    },
  )

  testRuntime(
    'subscribes only to incoming URLs after restoring a Model',
    async native => {
      const config = makeRoutedConfig()
      const previousProgram = await native.startProgram(config)
      expect(config.routing.onUrlChange).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ pathname: '/examples/counter' }),
      )

      previousProgram.dispatch(Message.ClickedIncrement())
      await native.flushAnimationFrames()
      config.routing.onUrlChange.mockClear()

      const program = await native.startProgram(config, 1)
      await native.flushMessages()

      expect(config.init).toHaveBeenCalledOnce()
      expect(config.routing.onUrlChange).not.toHaveBeenCalled()
      expect(Linking.getInitialURL).toHaveBeenCalledOnce()
      expect(Linking.addEventListener).toHaveBeenCalledTimes(2)
      expect(program.getModel().count).toBe(1)

      const [, onUrl] = Option.getOrThrow(
        Array.last(vi.mocked(Linking.addEventListener).mock.calls),
      )
      onUrl({ url: 'foldkit://examples/todo' })
      await native.flushMessages()

      expect(config.routing.onUrlChange).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ pathname: '/examples/todo' }),
      )
      expect(program.getModel().count).toBe(1)
    },
  )
})

describe('native DevTools runtime', () => {
  testRuntime(
    'records Messages and holds replay interaction until the live snapshot commits',
    async native => {
      const program = await native.createProgram()
      const socket = await native.connect()
      expect(Object.isFrozen(program.getModel())).toBe(false)
      expect(
        await native.sendRequest(socket, Request.RequestGetInit()),
      ).toMatchObject({
        _tag: 'ResponseInit',
        maybeModel: Option.some({ count: 0 }),
      })
      program.dispatch(Message.ClickedIncrement())
      await native.flushMessages()
      program.dispatch(Message.ClickedIncrement())
      await native.flushMessages()
      await native.flushAnimationFrames()
      expectCount(program, 2)
      expect(
        await native.sendRequest(socket, Request.RequestGetRuntimeState()),
      ).toMatchObject({
        _tag: 'ResponseRuntimeState',
        totalEntries: 2,
        isPaused: false,
        hasInitModel: true,
      })
      expect(
        await native.sendRequest(
          socket,
          Request.RequestListMessages({
            limit: 10,
            maybeSinceIndex: Option.none(),
            maybeChangedPathsMatch: Option.none(),
            fromEnd: false,
          }),
        ),
      ).toMatchObject({
        _tag: 'ResponseMessages',
        entries: expect.arrayContaining([
          expect.objectContaining({ tag: 'ClickedIncrement' }),
        ]),
      })
      const liveSnapshot = program.getSnapshot()
      expect(
        await native.sendRequest(
          socket,
          Request.RequestReplayToKeyframe({ keyframeIndex: 0 }),
        ),
      ).toMatchObject({ _tag: 'ResponseReplayed' })
      expectCount(program, 1)
      const replaySnapshot = program.getSnapshot()
      expect(program.getModel().count).toBe(2)
      program.acknowledgeCommittedSnapshot(liveSnapshot)
      program.dispatch(Message.ClickedIncrement())
      await native.flushMessages()
      expect(program.getModel().count).toBe(2)
      expect(
        await native.sendRequest(socket, Request.RequestGetRuntimeState()),
      ).toMatchObject({ totalEntries: 2, isPaused: true })

      await native.sendRequest(socket, Request.RequestResume())
      program.dispatch(Message.ClickedIncrement())
      await native.flushMessages()
      expect(program.getModel().count).toBe(2)
      await native.flushAnimationFrames()
      expectCount(program, 2)
      program.acknowledgeCommittedSnapshot(replaySnapshot)
      program.acknowledgeCommittedSnapshot(liveSnapshot)
      program.dispatch(Message.ClickedIncrement())
      await native.flushMessages()
      expect(program.getModel().count).toBe(2)
      program.acknowledgeCommittedSnapshot(program.getSnapshot())
      program.dispatch(Message.ClickedIncrement())
      await native.flushMessages()
      await native.flushAnimationFrames()
      expectCount(program, 3)
    },
  )

  testRuntime(
    'cancels pending live frames and preserves background updates during replay',
    async native => {
      const program = await native.createProgram({
        init: () => ({
          model: Model.make({ count: 0 }),
          commands: [WaitForIncrement()],
        }),
      })
      const socket = await native.connect()
      program.dispatch(Message.ClickedIncrement())
      await native.flushMessages()
      expect(native.pendingAnimationFrames()).toBe(1)
      await native.sendRequest(
        socket,
        Request.RequestReplayToKeyframe({ keyframeIndex: INIT_INDEX }),
      )
      expect(native.pendingAnimationFrames()).toBe(0)
      expectCount(program, 0)
      await vi.advanceTimersByTimeAsync(BACKGROUND_DELAY_MS)
      await native.flushAnimationFrames()
      expect(program.getModel().count).toBe(2)
      expectCount(program, 0)
      await native.sendRequest(socket, Request.RequestResume())
      await native.flushAnimationFrames()
      expectCount(program, 2)
      program.acknowledgeCommittedSnapshot(program.getSnapshot())
      program.dispatch(Message.ClickedIncrement())
      await native.flushMessages()
      expect(program.getModel().count).toBe(3)
    },
  )

  testRuntime(
    'ignores superseded restoration commits across rapid replay and resume',
    async native => {
      const program = await native.createProgram()
      const socket = await native.connect()
      program.dispatch(Message.ClickedIncrement())
      await native.flushMessages()
      await native.flushAnimationFrames()
      await native.sendRequest(
        socket,
        Request.RequestReplayToKeyframe({ keyframeIndex: INIT_INDEX }),
      )
      await native.sendRequest(socket, Request.RequestResume())
      await native.flushAnimationFrames()
      const firstRestoration = program.getSnapshot()
      await native.sendRequest(
        socket,
        Request.RequestReplayToKeyframe({ keyframeIndex: INIT_INDEX }),
      )
      program.acknowledgeCommittedSnapshot(firstRestoration)
      program.dispatch(Message.ClickedIncrement())
      await native.flushMessages()
      expect(program.getModel().count).toBe(1)
      await native.sendRequest(socket, Request.RequestResume())
      await native.flushAnimationFrames()
      program.acknowledgeCommittedSnapshot(firstRestoration)
      program.dispatch(Message.ClickedIncrement())
      await native.flushMessages()
      expect(program.getModel().count).toBe(1)
      program.acknowledgeCommittedSnapshot(program.getSnapshot())
      program.dispatch(Message.ClickedIncrement())
      await native.flushMessages()
      expect(program.getModel().count).toBe(2)
    },
  )

  testRuntime(
    'publishes the newest live Model when agent dispatch occurs before restoration commits',
    async native => {
      const program = await native.createProgram()
      const socket = await native.connect()
      program.dispatch(Message.ClickedIncrement())
      await native.flushMessages()
      await native.flushAnimationFrames()
      await native.sendRequest(
        socket,
        Request.RequestReplayToKeyframe({ keyframeIndex: INIT_INDEX }),
      )
      await native.sendRequest(socket, Request.RequestResume())
      await native.flushAnimationFrames()
      const previousRestoration = program.getSnapshot()
      await native.sendRequest(
        socket,
        Request.RequestDispatchMessage({ message: Message.ClickedIncrement() }),
      )
      await native.flushAnimationFrames()
      expectCount(program, 2)
      program.acknowledgeCommittedSnapshot(previousRestoration)
      program.dispatch(Message.ClickedIncrement())
      await native.flushMessages()
      expect(program.getModel().count).toBe(2)
      program.acknowledgeCommittedSnapshot(program.getSnapshot())
      program.dispatch(Message.ClickedIncrement())
      await native.flushMessages()
      expect(program.getModel().count).toBe(3)
    },
  )

  testRuntime(
    'restores the previous snapshot and keeps a failed first replay live',
    async native => {
      let isRejectingInitialView = false
      const program = await native.createProgram({
        view: (model: Model, h: NativeBuilder<Message>) => {
          if (isRejectingInitialView && model.count === 0) {
            throw new Error('Historical view failed')
          }
          return view(model, h)
        },
      })
      const socket = await native.connect()
      program.dispatch(Message.ClickedIncrement())
      await native.flushMessages()
      await native.flushAnimationFrames()
      const previousSnapshot = program.getSnapshot()
      isRejectingInitialView = true
      expect(
        await native.sendRequest(
          socket,
          Request.RequestReplayToKeyframe({ keyframeIndex: INIT_INDEX }),
        ),
      ).toMatchObject({ _tag: 'ResponseError' })
      expect(program.getSnapshot()).toBe(previousSnapshot)
      expect(
        await native.sendRequest(socket, Request.RequestGetRuntimeState()),
      ).toMatchObject({ isPaused: false })
      program.dispatch(Message.ClickedIncrement())
      await native.flushMessages()
      await native.flushAnimationFrames()
      expectCount(program, 2)
    },
  )

  testRuntime(
    'preserves an existing paused snapshot when another replay fails',
    async native => {
      let isRejectingInitialView = false
      const program = await native.createProgram({
        view: (model: Model, h: NativeBuilder<Message>) => {
          if (isRejectingInitialView && model.count === 0) {
            throw new Error('Historical view failed')
          }
          return view(model, h)
        },
      })
      const socket = await native.connect()
      program.dispatch(Message.ClickedIncrement())
      await native.flushMessages()
      program.dispatch(Message.ClickedIncrement())
      await native.flushMessages()
      await native.sendRequest(
        socket,
        Request.RequestReplayToKeyframe({ keyframeIndex: 0 }),
      )
      const previousSnapshot = program.getSnapshot()
      isRejectingInitialView = true
      expect(
        await native.sendRequest(
          socket,
          Request.RequestReplayToKeyframe({ keyframeIndex: INIT_INDEX }),
        ),
      ).toMatchObject({ _tag: 'ResponseError' })
      expect(program.getSnapshot()).toBe(previousSnapshot)
      program.dispatch(Message.ClickedIncrement())
      await native.flushMessages()
      expect(program.getModel().count).toBe(2)
      expect(
        await native.sendRequest(socket, Request.RequestGetRuntimeState()),
      ).toMatchObject({ isPaused: true })
    },
  )

  testRuntime(
    'replays an opaque Model without a configured Model Schema',
    async native => {
      const program = await native.startProgram({
        init: () => ({ model: Model.make({ count: 0 }) }),
        update,
        view,
        devTools: { Message },
      })
      const socket = await native.connect()
      program.dispatch(Message.ClickedIncrement())
      await native.flushMessages()
      await native.sendRequest(
        socket,
        Request.RequestReplayToKeyframe({ keyframeIndex: INIT_INDEX }),
      )
      expectCount(program, 0)
      expect(program.getModel().count).toBe(1)
    },
  )

  testRuntime(
    'decodes historical Models through the Schema type view',
    async native => {
      const program = await native.createProgram({
        Model: Schema.Struct({ count: Schema.NumberFromString }),
      })
      const socket = await native.connect()
      program.dispatch(Message.ClickedIncrement())
      await native.flushMessages()
      expect(
        await native.sendRequest(
          socket,
          Request.RequestReplayToKeyframe({ keyframeIndex: INIT_INDEX }),
        ),
      ).toMatchObject({ _tag: 'ResponseReplayed' })
      expectCount(program, 0)
      expect(program.getModel().count).toBe(1)
    },
  )

  testRuntime(
    'retains history and connection identity when the relay restarts',
    async native => {
      const program = await native.createProgram()
      const socket = await native.connect()
      const connectionId = readConnectionId(socket)
      program.dispatch(Message.ClickedIncrement())
      await native.flushMessages()
      socket.disconnect()
      program.dispatch(Message.ClickedIncrement())
      await native.flushMessages()
      await vi.advanceTimersByTimeAsync(250)
      const replacement = await native.connect()
      expect(readConnectionId(replacement)).toBe(connectionId)
      expect(
        await native.sendRequest(replacement, Request.RequestGetRuntimeState()),
      ).toMatchObject({ totalEntries: 2 })
    },
  )

  testRuntime(
    'prevents a restoration frame from replacing a crash view',
    async native => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const program = await native.createProgram()
      const socket = await native.connect()
      await native.sendRequest(
        socket,
        Request.RequestReplayToKeyframe({ keyframeIndex: INIT_INDEX }),
      )
      await native.sendRequest(socket, Request.RequestResume())
      await native.sendRequest(
        socket,
        Request.RequestDispatchMessage({ message: Message.ClickedCrash() }),
      )
      const crashSnapshot = program.getSnapshot()
      expect(crashSnapshot).toMatchObject({
        children: expect.arrayContaining([
          expect.objectContaining({ children: ['Application crash'] }),
        ]),
      })
      await native.flushAnimationFrames()
      expect(program.getSnapshot()).toBe(crashSnapshot)
    },
  )

  testRuntime(
    'disposes a pending restoration and closes the channel without reconnecting',
    async native => {
      const program = await native.createProgram()
      const socket = await native.connect()
      await native.sendRequest(
        socket,
        Request.RequestReplayToKeyframe({ keyframeIndex: INIT_INDEX }),
      )
      await native.sendRequest(socket, Request.RequestResume())
      const snapshot = program.getSnapshot()
      program.dispose()
      program.dispose()
      await vi.advanceTimersByTimeAsync(0)
      await native.flushAnimationFrames()
      program.acknowledgeCommittedSnapshot(snapshot)
      program.dispatch(Message.ClickedIncrement())
      await native.flushMessages()
      await vi.advanceTimersByTimeAsync(60000)
      expect(program.getSnapshot()).toBe(snapshot)
      expect(program.getModel().count).toBe(0)
      expect(socket.close).toHaveBeenCalledOnce()
      expect(FakeWebSocket.sockets).toHaveLength(1)
    },
  )

  for (const mode of ['omitted', 'false', 'release']) {
    testRuntime(
      `constructs no socket when DevTools is ${mode}`,
      async native => {
        if (mode === 'release') {
          vi.stubGlobal('__DEV__', false)
        }
        const config = {
          Model,
          init: () => ({ model: Model.make({ count: 0 }) }),
          update,
          view,
        }
        const devTools = mode === 'false' ? false : { Message }
        const program =
          mode === 'omitted'
            ? await native.startProgram(config)
            : await native.startProgram({ ...config, devTools })
        program.dispatch(Message.ClickedIncrement())
        await native.flushMessages()
        await native.flushAnimationFrames()
        expectCount(program, 1)
        expect(FakeWebSocket.sockets).toHaveLength(0)
        expect(vi.getTimerCount()).toBe(0)
      },
    )
  }
})
