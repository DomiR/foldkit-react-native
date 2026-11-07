import { Effect, Number, Schema } from 'effect'
import { Block } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import type { NativeBuilder } from '../src/builder'
import { type NativeProgram, makeNativeProgram } from '../src/runtime'
import { makeAnimationFrames } from './nativeFixtures'

const DRAIN_TURN_MS = 1
const DELAY_MS = 100

const Model = Schema.Struct({ count: Schema.Number })
type Model = typeof Model.Type

const Message = defineMessageUnion({
  ClickedIncrement: {},
  ClickedIncrementLater: {},
  CompletedWaitBeforeIncrement: {},
})
type Message = typeof Message.Type

const ApplicationKey = Symbol('Application')
const ApplicationBlock = Block.make('Application', {
  key: ApplicationKey,
  Model,
  Message,
  InitArgs: Schema.Tuple([]),
  view: { kind: 'Document' },
})

const { makeCommand, makeComposition, makeFieldsStep } = ApplicationBlock

const WaitBeforeIncrement = makeCommand('WaitBeforeIncrement', {
  messages: [Message.CompletedWaitBeforeIncrement],
  handler: function* () {
    return () =>
      Effect.as(Effect.sleep(DELAY_MS), Message.CompletedWaitBeforeIncrement())
  },
})

const ApplicationComposition = makeComposition()

const increment = makeFieldsStep(() => ({ count: Number.increment }))

const layer = ApplicationBlock.makeLayer({
  init: ApplicationComposition.makeInit(() => ({ model: { count: 0 } })),
  update: ApplicationComposition.makeUpdate({
    ClickedIncrement: increment,
    ClickedIncrementLater: model => ({
      model,
      commands: [WaitBeforeIncrement()],
    }),
    CompletedWaitBeforeIncrement: increment,
  }),
  view: ApplicationComposition.makeView((model, h) => ({
    title: 'Counter',
    body: h.p([], [globalThis.String(model.count)]),
  })),
  EffectsLayer: WaitBeforeIncrement.layer,
})

const view = (model: Model, h: NativeBuilder<Message>) =>
  h.button([h.OnClick(Message.ClickedIncrement())], [`${model.count}`])

let animationFrames: ReturnType<typeof makeAnimationFrames>
const programs: Array<NativeProgram<Model, Message>> = []

const flush = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(DRAIN_TURN_MS)
  animationFrames.flush()
  await vi.advanceTimersByTimeAsync(DRAIN_TURN_MS)
}

const startProgram = async (): Promise<NativeProgram<Model, Message>> => {
  const program = makeNativeProgram({
    id: `native-block-test-${programs.length}`,
    block: ApplicationBlock,
    layer,
    view,
  })
  programs.push(program)
  await flush()
  return program
}

beforeEach(() => {
  vi.useFakeTimers()
  animationFrames = makeAnimationFrames()
  vi.stubGlobal('__DEV__', true)
})

afterEach(async () => {
  for (const program of programs.splice(0)) {
    program.dispose()
  }
  await vi.advanceTimersByTimeAsync(DRAIN_TURN_MS)
})

it('runs a root Block with its native view', async () => {
  const program = await startProgram()

  expect(program.getModel()).toEqual({ count: 0 })
  expect(program.getSnapshot()).toMatchObject({ children: ['0'] })

  program.dispatch(Message.ClickedIncrement())
  await flush()

  expect(program.getModel()).toEqual({ count: 1 })
  expect(program.getSnapshot()).toMatchObject({ children: ['1'] })
})

it('runs Block Commands through the Block EffectsLayer', async () => {
  const program = await startProgram()

  program.dispatch(Message.ClickedIncrementLater())
  await flush()
  expect(program.getModel()).toEqual({ count: 0 })

  await vi.advanceTimersByTimeAsync(DELAY_MS)
  await flush()
  expect(program.getModel()).toEqual({ count: 1 })
})
