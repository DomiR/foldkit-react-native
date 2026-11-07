import { Number, Schema } from 'effect'
import { Block } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'

// MODEL

export const Model = Schema.Struct({
  count: Schema.Number,
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  ClickedDecrement: {},
  ClickedIncrement: {},
  ClickedReset: {},
})
export type Message = typeof Message.Type

// BLOCK

export const CounterKey = Symbol('Counter')
export const CounterBlock = Block.make('Counter', {
  key: CounterKey,
  InitArgs: Schema.Tuple([]),
  view: { kind: 'Element' },
  Model,
  Message,
})

const { makeComposition, makeFieldsStep } = CounterBlock

export const CounterComposition = makeComposition()

// INIT

export const init = CounterComposition.makeInit(() => ({
  model: { count: 0 },
}))

// UPDATE

export const update = CounterComposition.makeUpdate({
  ClickedDecrement: makeFieldsStep(() => ({
    count: Number.decrement,
  })),
  ClickedIncrement: makeFieldsStep(() => ({
    count: Number.increment,
  })),
  ClickedReset: makeFieldsStep(() => ({
    count: () => 0,
  })),
})
