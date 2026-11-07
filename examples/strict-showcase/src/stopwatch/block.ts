import {
  Clock,
  Duration,
  Effect,
  Layer,
  Schema,
  Stream,
  String,
  flow,
  pipe,
} from 'effect'
import { Block } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'

const TICK_INTERVAL_MS = 10

// MODEL

export const Model = Schema.Struct({
  elapsedMs: Schema.Number,
  isRunning: Schema.Boolean,
  startTime: Schema.Number,
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  ClickedStart: {},
  CompletedDetermineStartTime: { startTime: Schema.Number },
  ClickedStop: {},
  ClickedReset: {},
  Ticked: {},
  CompletedDetermineTickTime: { elapsedMs: Schema.Number },
})
export type Message = typeof Message.Type

// BLOCK

export const StopwatchKey = Symbol('Stopwatch')
export const StopwatchBlock = Block.make('Stopwatch', {
  key: StopwatchKey,
  InitArgs: Schema.Tuple([]),
  view: { kind: 'Element' },
  Model,
  Message,
})

const {
  makeCommand,
  makeCommandsStep,
  makeComposition,
  makeFieldsStep,
  makeSubscriptions,
} = StopwatchBlock

export const StopwatchComposition = makeComposition()

// COMMAND

export const DetermineStartTime = makeCommand('DetermineStartTime', {
  args: { elapsedMs: Schema.Number },
  messages: [Message.CompletedDetermineStartTime],
  handler: function* () {
    const clock = yield* Clock.Clock

    return ({ elapsedMs }) =>
      Effect.gen(function* () {
        const now = yield* clock.currentTimeMillis

        return Message.CompletedDetermineStartTime({
          startTime: now - elapsedMs,
        })
      })
  },
})

export const DetermineTickTime = makeCommand('DetermineTickTime', {
  args: { startTime: Schema.Number },
  messages: [Message.CompletedDetermineTickTime],
  handler: function* () {
    const clock = yield* Clock.Clock

    return ({ startTime }) =>
      Effect.gen(function* () {
        const now = yield* clock.currentTimeMillis

        return Message.CompletedDetermineTickTime({
          elapsedMs: now - startTime,
        })
      })
  },
})

// INIT

export const init = StopwatchComposition.makeInit(() => ({
  model: {
    elapsedMs: 0,
    isRunning: false,
    startTime: 0,
  },
}))

// UPDATE

export const update = StopwatchComposition.makeUpdate({
  ClickedStart: makeCommandsStep(model => [
    DetermineStartTime({ elapsedMs: model.elapsedMs }),
  ]),

  CompletedDetermineStartTime: makeFieldsStep.fromMessage(({ startTime }) => ({
    isRunning: () => true,
    startTime: () => startTime,
  })),

  ClickedStop: makeFieldsStep(() => ({
    isRunning: () => false,
  })),

  ClickedReset: makeFieldsStep(() => ({
    elapsedMs: () => 0,
    isRunning: () => false,
    startTime: () => 0,
  })),

  Ticked: makeCommandsStep(model => [
    DetermineTickTime({ startTime: model.startTime }),
  ]),

  CompletedDetermineTickTime: makeFieldsStep.fromMessage(({ elapsedMs }) => ({
    elapsedMs: () => elapsedMs,
  })),
})

// SUBSCRIPTION

export const subscriptions = makeSubscriptions(entry => ({
  stopwatchTicks: entry('StopwatchTicks', {
    messages: [Message.Ticked],
    when: model => model.isRunning,
    handler: function* () {
      return () =>
        Stream.tick(Duration.millis(TICK_INTERVAL_MS)).pipe(
          Stream.drop(1),
          Stream.map(Message.Ticked),
        )
    },
  }),
}))

// EFFECTS

export const EffectsLayer = Layer.mergeAll(
  DetermineStartTime.layer,
  DetermineTickTime.layer,
  subscriptions.layer,
)

// FORMAT

const floorAndPad = flow(Math.floor, v => v.toString(), String.padStart(2, '0'))

export const formatTime = (ms: number): string => {
  const minutes = pipe(Duration.millis(ms), Duration.toMinutes, floorAndPad)

  const seconds = pipe(
    Duration.millis(ms % 60000),
    Duration.toSeconds,
    floorAndPad,
  )

  const centiseconds = pipe(
    Duration.millis(ms % 1000),
    Duration.toMillis,
    v => v / 10,
    floorAndPad,
  )

  return `${minutes}:${seconds}.${centiseconds}`
}
