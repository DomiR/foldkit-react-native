import * as Counter from 'counter-example/program'
import { Array, Effect, Option, Schema } from 'effect'
import type { KeyValueStore } from 'effect/persistence'
import * as Command from 'foldkit/command'
import { defineMessageUnion } from 'foldkit/message'
import { UrlRequest } from 'foldkit/navigation'
import type { RoutingConfig } from 'foldkit/runtime'
import { defineTaggedUnion } from 'foldkit/schema'
import { PanEnd } from 'foldkit/strict'
import { modifyFields } from 'foldkit/struct'
import * as Subscription from 'foldkit/subscription'
import * as Update from 'foldkit/update'
import { Url, toString as urlToString } from 'foldkit/url'
import * as Form from 'form-example/program'
import * as Stopwatch from 'stopwatch-example/program'
import * as Todo from 'todo-example/program'

import * as Animations from './animations/program'
import { ShowcaseNavigation } from './navigation'
import { AppRoute, appRouteToUrl, urlToAppRoute } from './route'

// MODEL

export const Example = Schema.Literals(['Counter', 'Stopwatch', 'Todo', 'Form'])
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
  animations: Animations.Model,
  taps: Schema.Number,
  likes: Schema.Number,
  dislikes: Schema.Number,
  maybeLastPan: Schema.Option(PanEnd),
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  ChangedUrl: { url: Url },
  ClickedLink: { request: UrlRequest },
  CompletedPushUrl: {},
  CompletedReplaceUrl: {},
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
  GotAnimationsMessage: { message: Animations.Message },
})
export type Message = typeof Message.Type

export const routing: RoutingConfig<Message> = {
  onUrlRequest: request => Message.ClickedLink({ request }),
  onUrlChange: url => Message.ChangedUrl({ url }),
}

export const toGotCounterMessage = (message: Counter.Message): Message =>
  Message.GotCounterMessage({ message })
export const toGotStopwatchMessage = (message: Stopwatch.Message): Message =>
  Message.GotStopwatchMessage({ message })
export const toGotTodoMessage = (message: Todo.Message): Message =>
  Message.GotTodoMessage({ message })
export const toGotFormMessage = (message: Form.Message): Message =>
  Message.GotFormMessage({ message })

export const toGotAnimationsMessage = (message: Animations.Message): Message =>
  Message.GotAnimationsMessage({ message })

type UpdateReturn = Update.Return<
  Model,
  Message,
  KeyValueStore.KeyValueStore | Animations.Requirements | ShowcaseNavigation
>

// INIT

export const init = (flags: Todo.Flags, url: Url): UpdateReturn => {
  const counterInit = Counter.init()
  const stopwatchInit = Stopwatch.init()
  const todoInit = Todo.init(flags)
  const formInit = Form.init()
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

  const model = Model.make({
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
    animations: animationsInit.model,
  })

  return {
    model: applyAppRoute(model, urlToAppRoute(url)),
    commands,
  }
}

// COMMAND

export const PushUrl = Command.define('PushUrl', {
  args: { url: Schema.String },
  messages: [Message.CompletedPushUrl],
  execute: ({ url }) =>
    Effect.gen(function* () {
      const navigation = yield* ShowcaseNavigation
      yield* navigation.pushUrl(url)
      return Message.CompletedPushUrl()
    }),
})

export const ReplaceUrl = Command.define('ReplaceUrl', {
  args: { url: Schema.String },
  messages: [Message.CompletedReplaceUrl],
  execute: ({ url }) =>
    Effect.gen(function* () {
      const navigation = yield* ShowcaseNavigation
      yield* navigation.replaceUrl(url)
      return Message.CompletedReplaceUrl()
    }),
})

const exampleScreen = (example: Example, id: number): ShowcaseRoute => {
  const routes: Readonly<Record<Example, ShowcaseRoute>> = {
    Counter: ShowcaseRoute.Counter({ id }),
    Stopwatch: ShowcaseRoute.Stopwatch({ id }),
    Todo: ShowcaseRoute.Todo({ id }),
    Form: ShowcaseRoute.Form({ id }),
  }

  return routes[example]
}

const applyExampleRoute = (model: Model, example: Example): Model => {
  const topRoute = Array.lastNonEmpty(model.stack)

  if (topRoute._tag === example) {
    return modifyFields(model, { tabs: () => 'Examples' })
  }

  const root = Array.headNonEmpty(model.stack)
  const nextStack = Array.prepend(
    [exampleScreen(example, model.nextScreenId)],
    root,
  )

  return modifyFields(model, {
    tabs: () => 'Examples',
    stack: () => nextStack,
    nextScreenId: nextScreenId => nextScreenId + 1,
  })
}

export const applyAppRoute = (model: Model, appRoute: AppRoute): Model =>
  AppRoute.match<Model>(appRoute, {
    Examples: () =>
      modifyFields(model, {
        tabs: () => 'Examples',
        stack: stack => [Array.headNonEmpty(stack)],
      }),
    Counter: () => applyExampleRoute(model, 'Counter'),
    Stopwatch: () => applyExampleRoute(model, 'Stopwatch'),
    Todo: () => applyExampleRoute(model, 'Todo'),
    Form: () => applyExampleRoute(model, 'Form'),
    Gestures: () => modifyFields(model, { tabs: () => 'Gestures' }),
    Animations: () => modifyFields(model, { tabs: () => 'Animations' }),
    NotFound: () => model,
  })

export const modelToAppRoute = (model: Model): AppRoute => {
  if (model.tabs === 'Gestures') {
    return AppRoute.Gestures()
  }

  if (model.tabs === 'Animations') {
    return AppRoute.Animations()
  }

  const topRoute = Array.lastNonEmpty(model.stack)

  return ShowcaseRoute.match<AppRoute>(topRoute, {
    Home: () => AppRoute.Examples(),
    Counter: () => AppRoute.Counter(),
    Stopwatch: () => AppRoute.Stopwatch(),
    Todo: () => AppRoute.Todo(),
    Form: () => AppRoute.Form(),
  })
}

const syncUrl = (
  model: Model,
  nextModel: Model,
  makeCommand: (
    url: string,
  ) => ReturnType<typeof PushUrl> | ReturnType<typeof ReplaceUrl>,
): UpdateReturn => {
  const currentUrl = appRouteToUrl(modelToAppRoute(model))
  const nextUrl = appRouteToUrl(modelToAppRoute(nextModel))

  if (currentUrl === nextUrl) {
    return { model: nextModel }
  }

  return { model: nextModel, commands: [makeCommand(nextUrl)] }
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

const foldAnimations = Update.foldChild({
  update: Animations.update,
  read: (model: Model) => Option.some(model.animations),
  write: (model, nextAnimations) =>
    modifyFields(model, { animations: () => nextAnimations }),
  toParentMessage: toGotAnimationsMessage,
})

export const update = (model: Model, message: Message) =>
  Message.match<UpdateReturn>(message, {
    ChangedUrl: ({ url }) => ({
      model: applyAppRoute(model, urlToAppRoute(url)),
    }),
    ClickedLink: ({ request }) =>
      UrlRequest.match<UpdateReturn>(request, {
        Internal: ({ url }) => ({
          model,
          commands: [PushUrl({ url: urlToString(url) })],
        }),
        External: () => ({ model }),
      }),
    CompletedPushUrl: () => ({ model }),
    CompletedReplaceUrl: () => ({ model }),
    PressedExampleRow: ({ example }) => {
      const nextStack = Array.append(
        model.stack,
        exampleScreen(example, model.nextScreenId),
      )
      const nextModel = modifyFields(model, {
        stack: () => nextStack,
        nextScreenId: nextScreenId => nextScreenId + 1,
      })

      return syncUrl(model, nextModel, url => PushUrl({ url }))
    },
    DismissedScreens: ({ dismissedCount }) => {
      const root = Array.headNonEmpty(model.stack)
      const remaining = Array.dropRight(
        Array.tailNonEmpty(model.stack),
        Math.max(0, Math.floor(dismissedCount)),
      )
      const nextStack = Array.prepend(remaining, root)
      const nextModel = modifyFields(model, { stack: () => nextStack })

      return syncUrl(model, nextModel, url => ReplaceUrl({ url }))
    },
    SelectedTab: ({ key }) =>
      Option.match(Schema.decodeUnknownOption(TabSelection)(key), {
        onNone: () => ({ model }),
        onSome: tab => {
          const nextModel = modifyFields(model, { tabs: () => tab })

          return syncUrl(model, nextModel, url => PushUrl({ url }))
        },
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
