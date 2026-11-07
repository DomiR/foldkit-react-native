import { Array, Layer, Schema } from 'effect'
import { Block } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { type StrictView, embedBlock, embedKeyedBlock } from 'foldkit/strict'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import type { NativeChild, NativeNode } from '../src/node'
import { type NativeProgram, makeNativeProgram } from '../src/runtime'
import { makeAnimationFrames } from './nativeFixtures'

const DRAIN_TURN_MS = 1

// CHILD

const CounterModel = Schema.Struct({ count: Schema.Number })
type CounterModel = typeof CounterModel.Type
const CounterMessage = defineMessageUnion({ ClickedIncrement: {} })
type CounterMessage = typeof CounterMessage.Type

const CounterKey = Symbol('Counter')
const CounterBlock = Block.make('Counter', {
  key: CounterKey,
  InitArgs: Schema.Tuple([]),
  view: { kind: 'Element' },
  Model: CounterModel,
  Message: CounterMessage,
})
const CounterComposition = CounterBlock.makeComposition()
const counterLayer = CounterBlock.makeLayer({
  init: CounterComposition.makeInit(() => ({ model: { count: 0 } })),
  update: CounterComposition.makeUpdate({
    ClickedIncrement: CounterBlock.makeFieldsStep(() => ({
      count: count => count + 1,
    })),
  }),
  view: CounterComposition.makeView((model, h) =>
    h.p([], [globalThis.String(model.count)]),
  ),
})

const counterView: StrictView<CounterModel, CounterMessage> = (model, h) =>
  h.button(
    [h.OnClick(CounterMessage.ClickedIncrement())],
    [globalThis.String(model.count)],
  )

// PARENT

const Model = Schema.Struct({
  primary: CounterBlock.Model,
  rows: Schema.Array(CounterBlock.Instance),
})
const Message = defineMessageUnion({ ClickedAddRow: {} })

const ApplicationKey = Symbol('Application')
const ApplicationBlock = Block.make('Application', {
  key: ApplicationKey,
  InitArgs: Schema.Tuple([]),
  view: { kind: 'Document' },
  Model,
  Message,
})
const CounterBinding = ApplicationBlock.makeRequiredFieldBinding(CounterBlock, {
  field: 'primary',
})
const RowsBinding = ApplicationBlock.makeKeyedArrayBinding(CounterBlock, {
  field: 'rows',
  key: 'key',
  childField: 'model',
})
const ApplicationComposition = ApplicationBlock.makeComposition({
  bindings: [CounterBinding, RowsBinding],
})
const addRow = ApplicationBlock.makeFieldsStep(model => ({
  rows: Array.append(
    RowsBinding.create({ key: `row-${model.rows.length}`, args: [] }),
  ),
}))
const layer = ApplicationBlock.makeLayer({
  init: ApplicationComposition.makeInit(() => ({
    model: { rows: [] },
    steps: [addRow, addRow],
  })),
  update: ApplicationComposition.makeUpdate({ ClickedAddRow: addRow }),
  view: ApplicationComposition.makeView((_model, h) => ({
    title: 'Parent',
    body: h.div([]),
  })),
}).pipe(Layer.provide(counterLayer))

type ParentModel = typeof ApplicationBlock.Model.Type
type ParentMessage = typeof ApplicationBlock.Message.Type

const parentView: StrictView<ParentModel, ParentMessage> = (model, h) =>
  h.div(
    [],
    [
      embedBlock(h, CounterBinding, model.primary, counterView),
      ...Array.map(model.rows, row =>
        embedKeyedBlock(h, RowsBinding, row.key, row.model, counterView),
      ),
    ],
  )

// HARNESS

let animationFrames: ReturnType<typeof makeAnimationFrames>
const programs: Array<NativeProgram<ParentModel, ParentMessage>> = []

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('__DEV__', true)
  animationFrames = makeAnimationFrames()
})

afterEach(() => {
  for (const program of programs.splice(0)) {
    program.dispose()
  }
})

const flush = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(DRAIN_TURN_MS)
  animationFrames.flush()
  await vi.advanceTimersByTimeAsync(DRAIN_TURN_MS)
}

const buttons = (
  child: NativeChild<ParentMessage>,
): ReadonlyArray<NativeNode<ParentMessage>> => {
  if (child === null || typeof child === 'string' || child._tag !== 'Element') {
    return []
  }
  return child.tag === 'button' ? [child] : child.children.flatMap(buttons)
}

const press = (
  program: NativeProgram<ParentModel, ParentMessage>,
  index: number,
): void => {
  const button = buttons(program.getSnapshot())[index]
  if (button?._tag === 'Element' && button.attributes.onClick !== undefined) {
    program.dispatch(button.attributes.onClick)
  } else {
    throw new Error(`No button at ${index}`)
  }
}

const labels = (program: NativeProgram<ParentModel, ParentMessage>) =>
  buttons(program.getSnapshot()).map(button =>
    button._tag === 'Element' ? button.children : [],
  )

const startProgram = async () => {
  const program = makeNativeProgram({
    id: `native-block-child-${programs.length}`,
    block: ApplicationBlock,
    layer,
    view: parentView,
  })
  programs.push(program)
  await flush()
  return program
}

it('renders a child Block strict view and routes its Messages', async () => {
  const program = await startProgram()
  expect(labels(program)).toEqual([['0'], ['0'], ['0']])

  press(program, 0)
  await flush()

  expect(program.getModel().primary).toEqual({ count: 1 })
  expect(labels(program)).toEqual([['1'], ['0'], ['0']])
})

it('routes keyed child Messages to their own occurrence', async () => {
  const program = await startProgram()

  press(program, 2)
  await flush()
  press(program, 2)
  await flush()

  expect(labels(program)).toEqual([['0'], ['0'], ['2']])
})
