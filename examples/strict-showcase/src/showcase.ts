import * as Counter from 'counter-example/program'
import { Array, Option, Schema } from 'effect'
import type { KeyValueStore } from 'effect/persistence'
import * as Command from 'foldkit/command'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { PanEnd } from 'foldkit/strict'
import { modifyFields } from 'foldkit/struct'
import * as Subscription from 'foldkit/subscription'
import * as Update from 'foldkit/update'
import * as Form from 'form-example/program'
import * as Stopwatch from 'stopwatch-example/program'
import * as Todo from 'todo-example/program'

import * as Animations from './animations/program'
import * as Contacts from './contacts/program'

// MODEL

export const Example = Schema.Literals([
  'Counter',
  'Stopwatch',
  'Todo',
  'Form',
  'Contacts',
])
export type Example = typeof Example.Type

export const TabSelection = Schema.Literals([
  'Examples',
  'Gestures',
  'Animations',
])
export type TabSelection = typeof TabSelection.Type

export const ShowcaseRoute = defineTaggedUnion({
  Home: { id: Schema.Number },
  Counter: { id: Schema.Number },
  Stopwatch: { id: Schema.Number },
  Todo: { id: Schema.Number },
  Form: { id: Schema.Number },
  Contacts: { id: Schema.Number },
})
export type ShowcaseRoute = typeof ShowcaseRoute.Type

export const Model = Schema.Struct({
  tabs: TabSelection,
  stack: Schema.NonEmptyArray(ShowcaseRoute),
  nextScreenId: Schema.Number,
  counter: Counter.Model,
  stopwatch: Stopwatch.Model,
  todo: Todo.Model,
  form: Form.Model,
  contacts: Contacts.Model,
  animations: Animations.Model,
  taps: Schema.Number,
  likes: Schema.Number,
  dislikes: Schema.Number,
  maybeLastPan: Schema.Option(PanEnd),
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  PressedExampleRow: { example: Example },
  DismissedScreens: { dismissedCount: Schema.Number },
  SelectedTab: { key: Schema.String },
  TappedCard: {},
  LongPressedCard: {},
  SwipedCard: { direction: Schema.Literals(['Left', 'Right']) },
  EndedCardPan: { event: PanEnd },
  GotCounterMessage: { message: Counter.Message },
  GotStopwatchMessage: { message: Stopwatch.Message },
  GotTodoMessage: { message: Todo.Message },
  GotFormMessage: { message: Form.Message },
  GotContactsMessage: { message: Contacts.Message },
  GotAnimationsMessage: { message: Animations.Message },
})
export type Message = typeof Message.Type

export const toGotCounterMessage = (message: Counter.Message): Message =>
  Message.GotCounterMessage({ message })
export const toGotStopwatchMessage = (message: Stopwatch.Message): Message =>
  Message.GotStopwatchMessage({ message })
export const toGotTodoMessage = (message: Todo.Message): Message =>
  Message.GotTodoMessage({ message })
export const toGotFormMessage = (message: Form.Message): Message =>
  Message.GotFormMessage({ message })

export const toGotContactsMessage = (message: Contacts.Message): Message =>
  Message.GotContactsMessage({ message })

export const toGotAnimationsMessage = (message: Animations.Message): Message =>
  Message.GotAnimationsMessage({ message })

type UpdateReturn = Update.Return<
  Model,
  Message,
  KeyValueStore.KeyValueStore | Animations.Requirements
>

// INIT

export const init = (flags: Todo.Flags): UpdateReturn => {
  const counterInit = Counter.init()
  const stopwatchInit = Stopwatch.init()
  const todoInit = Todo.init(flags)
  const formInit = Form.init()
  const contactsInit = Contacts.init()
  const animationsInit = Animations.init()

  const commands = [
    ...(Command.mapMessages(counterInit.commands, toGotCounterMessage) ?? []),
    ...(Command.mapMessages(stopwatchInit.commands, toGotStopwatchMessage) ??
      []),
    ...(Command.mapMessages(todoInit.commands, toGotTodoMessage) ?? []),
    ...(Command.mapMessages(formInit.commands, toGotFormMessage) ?? []),
    ...(Command.mapMessages(animationsInit.commands, toGotAnimationsMessage) ??
      []),
  ]

  return {
    model: Model.make({
      tabs: 'Examples',
      stack: [ShowcaseRoute.Home({ id: 0 })],
      nextScreenId: 1,
      taps: 0,
      likes: 0,
      dislikes: 0,
      maybeLastPan: Option.none(),
      counter: counterInit.model,
      stopwatch: stopwatchInit.model,
      todo: todoInit.model,
      form: formInit.model,
      contacts: contactsInit.model,
      animations: animationsInit.model,
    }),
    commands,
  }
}

// UPDATE

const foldCounter = Update.foldChild({
  update: Counter.update,
  read: (model: Model) => Option.some(model.counter),
  write: (model, nextCounter) =>
    modifyFields(model, { counter: () => nextCounter }),
  toParentMessage: toGotCounterMessage,
})
const foldStopwatch = Update.foldChild({
  update: Stopwatch.update,
  read: (model: Model) => Option.some(model.stopwatch),
  write: (model, nextStopwatch) =>
    modifyFields(model, { stopwatch: () => nextStopwatch }),
  toParentMessage: toGotStopwatchMessage,
})
const foldTodo = Update.foldChild({
  update: Todo.update,
  read: (model: Model) => Option.some(model.todo),
  write: (model, nextTodo) => modifyFields(model, { todo: () => nextTodo }),
  toParentMessage: toGotTodoMessage,
})
const foldForm = Update.foldChild({
  update: Form.update,
  read: (model: Model) => Option.some(model.form),
  write: (model, nextForm) => modifyFields(model, { form: () => nextForm }),
  toParentMessage: toGotFormMessage,
})

const foldContacts = Update.foldChild({
  update: Contacts.update,
  read: (model: Model) => Option.some(model.contacts),
  write: (model, nextContacts) =>
    modifyFields(model, { contacts: () => nextContacts }),
  toParentMessage: toGotContactsMessage,
})

const foldAnimations = Update.foldChild({
  update: Animations.update,
  read: (model: Model) => Option.some(model.animations),
  write: (model, nextAnimations) =>
    modifyFields(model, { animations: () => nextAnimations }),
  toParentMessage: toGotAnimationsMessage,
})

export const update = (model: Model, message: Message) =>
  Message.match<UpdateReturn>(message, {
    PressedExampleRow: ({ example }) => {
      const id = model.nextScreenId
      const routes: Readonly<Record<Example, ShowcaseRoute>> = {
        Counter: ShowcaseRoute.Counter({ id }),
        Stopwatch: ShowcaseRoute.Stopwatch({ id }),
        Todo: ShowcaseRoute.Todo({ id }),
        Form: ShowcaseRoute.Form({ id }),
        Contacts: ShowcaseRoute.Contacts({ id }),
      }
      const nextStack = Array.append(model.stack, routes[example])

      return {
        model: modifyFields(model, {
          stack: () => nextStack,
          nextScreenId: nextScreenId => nextScreenId + 1,
        }),
      }
    },
    DismissedScreens: ({ dismissedCount }) => {
      const root = Array.headNonEmpty(model.stack)
      const remaining = Array.dropRight(
        Array.tailNonEmpty(model.stack),
        Math.max(0, Math.floor(dismissedCount)),
      )
      const nextStack = Array.prepend(remaining, root)

      return { model: modifyFields(model, { stack: () => nextStack }) }
    },
    SelectedTab: ({ key }) =>
      Option.match(Schema.decodeUnknownOption(TabSelection)(key), {
        onNone: () => ({ model }),
        onSome: tab => ({ model: modifyFields(model, { tabs: () => tab }) }),
      }),
    TappedCard: () => ({
      model: modifyFields(model, { taps: taps => taps + 1 }),
    }),
    LongPressedCard: () => ({
      model: modifyFields(model, {
        taps: () => 0,
        likes: () => 0,
        dislikes: () => 0,
        maybeLastPan: () => Option.none(),
      }),
    }),
    SwipedCard: ({ direction }) => ({
      model:
        direction === 'Right'
          ? modifyFields(model, { likes: likes => likes + 1 })
          : modifyFields(model, { dislikes: dislikes => dislikes + 1 }),
    }),
    EndedCardPan: ({ event }) => ({
      model: modifyFields(model, { maybeLastPan: () => Option.some(event) }),
    }),
    GotCounterMessage: ({ message }) => foldCounter(model, message),
    GotStopwatchMessage: ({ message }) => foldStopwatch(model, message),
    GotTodoMessage: ({ message }) => foldTodo(model, message),
    GotFormMessage: ({ message }) => foldForm(model, message),
    GotContactsMessage: ({ message }) => foldContacts(model, message),
    GotAnimationsMessage: ({ message }) => foldAnimations(model, message),
  })

// SUBSCRIPTION

const stopwatchSubscriptions = Subscription.lift(Stopwatch.subscriptions)<
  Model,
  Message
>({
  read: model => Option.some(model.stopwatch),
  toParentMessage: toGotStopwatchMessage,
})

const animationSubscriptions = Subscription.lift(Animations.subscriptions)<
  Model,
  Message
>({
  read: model => Option.some(model.animations),
  toParentMessage: toGotAnimationsMessage,
})
export const subscriptions = Subscription.aggregate(
  stopwatchSubscriptions,
  animationSubscriptions,
)
