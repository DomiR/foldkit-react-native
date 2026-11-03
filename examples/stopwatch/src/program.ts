import {
  Clock,
  Duration,
  Effect,
  Schema,
  Stream,
  String,
  flow,
  pipe,
} from 'effect'
import * as Command from 'foldkit/command'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'
import * as Subscription from 'foldkit/subscription'
import type * as Update from 'foldkit/update'

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

// COMMAND

export const DetermineStartTime = Command.define('DetermineStartTime', {
  args: { elapsedMs: Schema.Number },
  messages: [Message.CompletedDetermineStartTime],
  execute: ({ elapsedMs }) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      return Message.CompletedDetermineStartTime({ startTime: now - elapsedMs })
    }),
})

export const DetermineTickTime = Command.define('DetermineTickTime', {
  args: { startTime: Schema.Number },
  messages: [Message.CompletedDetermineTickTime],
  execute: ({ startTime }) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      return Message.CompletedDetermineTickTime({ elapsedMs: now - startTime })
    }),
})

// UPDATE

export const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message>>(message, {
    ClickedStart: () => ({
      model,
      commands: [DetermineStartTime({ elapsedMs: model.elapsedMs })],
    }),

    CompletedDetermineStartTime: ({ startTime }) => ({
      model: modifyFields(model, {
        isRunning: () => true,
        startTime: () => startTime,
      }),
    }),

    ClickedStop: () => ({
      model: modifyFields(model, {
        isRunning: () => false,
      }),
    }),

    ClickedReset: () => ({
      model: modifyFields(model, {
        elapsedMs: () => 0,
        isRunning: () => false,
        startTime: () => 0,
      }),
    }),

    Ticked: () => ({
      model,
      commands: [DetermineTickTime({ startTime: model.startTime })],
    }),

    CompletedDetermineTickTime: ({ elapsedMs }) => ({
      model: modifyFields(model, {
        elapsedMs: () => elapsedMs,
      }),
    }),
  })

// INIT

export const init: () => Update.Return<Model, Message> = () => ({
  model: {
    elapsedMs: 0,
    isRunning: false,
    startTime: 0,
  },
})

// SUBSCRIPTION

export const subscriptions = Subscription.make<Model, Message>()(entry => ({
  tick: entry(
    { isRunning: Schema.Boolean },
    {
      modelToDependencies: model => ({ isRunning: model.isRunning }),
      dependenciesToStream: ({ isRunning }) =>
        Stream.when(
          Stream.tick(Duration.millis(TICK_INTERVAL_MS)).pipe(
            Stream.drop(1),
            Stream.map(Message.Ticked),
          ),
          Effect.sync(() => isRunning),
        ),
    },
  ),
}))

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
    value => value / 10,
    floorAndPad,
  )

  return `${minutes}:${seconds}.${centiseconds}`
}

const floorAndPad = flow(
  Math.floor,
  value => value.toString(),
  String.padStart(2, '0'),
)
