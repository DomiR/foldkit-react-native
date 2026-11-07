import { Array, Effect, Option, Schema } from 'effect'
import { KeyValueStore } from 'effect/persistence'
import { Block } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { UrlRequest } from 'foldkit/navigation'
import type { RoutingConfig } from 'foldkit/runtime'
import { defineTaggedUnion } from 'foldkit/schema'
import { AnimatedValues, BackgroundRuntime, PanEnd } from 'foldkit/strict'
import { modifyFields } from 'foldkit/struct'
import { Url, toString as urlToString } from 'foldkit/url'

import { AnimationsBlock } from './animations/block'
import { ChatBlock } from './chat/block'
import { ContactsBlock } from './contacts/block'
import { CounterBlock } from './counter/block'
import { FormBlock } from './form/block'
import { ShowcaseNavigation } from './navigation'
import { AppRoute, appRouteToUrl, urlToAppRoute } from './route'
import { StopwatchBlock } from './stopwatch/block'
import { TodoBlock } from './todo/block'

// MODEL

export const Example = Schema.Literals([
  'Counter',
  'Stopwatch',
  'Todo',
  'Form',
  'Contacts',
  'Chat',
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
  Chat: { id: Schema.Number },
})
export type ShowcaseRoute = typeof ShowcaseRoute.Type

export const Model = Schema.Struct({
  tabs: TabSelection,
  stack: Schema.NonEmptyArray(ShowcaseRoute),
  nextScreenId: Schema.Number,
  counter: CounterBlock.Model,
  stopwatch: StopwatchBlock.Model,
  todo: TodoBlock.Model,
  form: FormBlock.Model,
  contacts: ContactsBlock.Model,
  chat: ChatBlock.Model,
  animations: AnimationsBlock.Model,
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
})
export type Message = typeof Message.Type

export const routing: RoutingConfig<Message> = {
  onUrlRequest: request => Message.ClickedLink({ request }),
  onUrlChange: url => Message.ChangedUrl({ url }),
}

// BLOCK

export const ShowcaseKey = Symbol('Showcase')
export const ShowcaseBlock = Block.make('Showcase', {
  key: ShowcaseKey,
  InitArgs: Schema.Tuple([Url]),
  view: { kind: 'Document' },
  effects: {
    services: [
      ShowcaseNavigation,
      KeyValueStore.KeyValueStore,
      AnimatedValues,
      BackgroundRuntime,
    ],
  },
  Model,
  Message,
})

const { makeCommand, makeComposition, makeRequiredFieldBinding } = ShowcaseBlock

export const CounterBinding = makeRequiredFieldBinding(CounterBlock, {
  field: 'counter',
})
export const StopwatchBinding = makeRequiredFieldBinding(StopwatchBlock, {
  field: 'stopwatch',
})
export const TodoBinding = makeRequiredFieldBinding(TodoBlock, {
  field: 'todo',
})
export const FormBinding = makeRequiredFieldBinding(FormBlock, {
  field: 'form',
})
export const ContactsBinding = makeRequiredFieldBinding(ContactsBlock, {
  field: 'contacts',
})
export const ChatBinding = makeRequiredFieldBinding(ChatBlock, {
  field: 'chat',
})
export const AnimationsBinding = makeRequiredFieldBinding(AnimationsBlock, {
  field: 'animations',
})

export const ShowcaseComposition = makeComposition({
  bindings: [
    CounterBinding,
    StopwatchBinding,
    TodoBinding,
    FormBinding,
    ContactsBinding,
    ChatBinding,
    AnimationsBinding,
  ],
})

// COMMAND

export const PushUrl = makeCommand('PushUrl', {
  args: { url: Schema.String },
  messages: [Message.CompletedPushUrl],
  handler: function* () {
    const navigation = yield* ShowcaseNavigation

    return ({ url }) =>
      navigation.pushUrl(url).pipe(Effect.as(Message.CompletedPushUrl()))
  },
})

export const ReplaceUrl = makeCommand('ReplaceUrl', {
  args: { url: Schema.String },
  messages: [Message.CompletedReplaceUrl],
  handler: function* () {
    const navigation = yield* ShowcaseNavigation

    return ({ url }) =>
      navigation.replaceUrl(url).pipe(Effect.as(Message.CompletedReplaceUrl()))
  },
})

const exampleScreen = (example: Example, id: number): ShowcaseRoute => {
  const routes: Readonly<Record<Example, ShowcaseRoute>> = {
    Counter: ShowcaseRoute.Counter({ id }),
    Stopwatch: ShowcaseRoute.Stopwatch({ id }),
    Todo: ShowcaseRoute.Todo({ id }),
    Form: ShowcaseRoute.Form({ id }),
    Contacts: ShowcaseRoute.Contacts({ id }),
    Chat: ShowcaseRoute.Chat({ id }),
  }

  return routes[example]
}

type NavigationModel = Pick<Model, 'tabs' | 'stack' | 'nextScreenId'>

const applyExampleRoute = (
  model: NavigationModel,
  example: Example,
): NavigationModel => {
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

const routeNavigation = (
  model: NavigationModel,
  appRoute: AppRoute,
): NavigationModel =>
  AppRoute.match<NavigationModel>(appRoute, {
    Examples: () =>
      modifyFields(model, {
        tabs: () => 'Examples',
        stack: stack => [Array.headNonEmpty(stack)],
      }),
    Counter: () => applyExampleRoute(model, 'Counter'),
    Stopwatch: () => applyExampleRoute(model, 'Stopwatch'),
    Todo: () => applyExampleRoute(model, 'Todo'),
    Form: () => applyExampleRoute(model, 'Form'),
    Contacts: () => applyExampleRoute(model, 'Contacts'),
    Chat: () => applyExampleRoute(model, 'Chat'),
    Gestures: () => modifyFields(model, { tabs: () => 'Gestures' }),
    Animations: () => modifyFields(model, { tabs: () => 'Animations' }),
    NotFound: () => model,
  })

const navigationOf = ({
  tabs,
  stack,
  nextScreenId,
}: NavigationModel): NavigationModel => ({ tabs, stack, nextScreenId })

export const applyAppRoute = (model: Model, appRoute: AppRoute): Model => {
  const navigation = routeNavigation(navigationOf(model), appRoute)

  return modifyFields(model, {
    tabs: () => navigation.tabs,
    stack: () => navigation.stack,
    nextScreenId: () => navigation.nextScreenId,
  })
}

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
    Contacts: () => AppRoute.Contacts(),
    Chat: () => AppRoute.Chat(),
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

type UpdateReturn = Readonly<{
  model: Model
  commands?: ReadonlyArray<
    ReturnType<typeof PushUrl> | ReturnType<typeof ReplaceUrl>
  >
}>

const updateShowcase = (model: Model, message: Message) =>
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
  })

export const update = ShowcaseComposition.makeUpdate({
  ChangedUrl: updateShowcase,
  ClickedLink: updateShowcase,
  CompletedPushUrl: updateShowcase,
  CompletedReplaceUrl: updateShowcase,
  PressedExampleRow: updateShowcase,
  DismissedScreens: updateShowcase,
  SelectedTab: updateShowcase,
  TappedCard: updateShowcase,
  LongPressedCard: updateShowcase,
  SwipedCard: updateShowcase,
  EndedCardPan: updateShowcase,
})

// INIT

export const init = ShowcaseComposition.makeInit((url: Url) => ({
  model: {
    ...routeNavigation(
      {
        tabs: 'Examples',
        stack: [ShowcaseRoute.Home({ id: 0 })],
        nextScreenId: 1,
      },
      urlToAppRoute(url),
    ),
    taps: 0,
    likes: 0,
    dislikes: 0,
    maybeLastPan: Option.none(),
  },
}))
