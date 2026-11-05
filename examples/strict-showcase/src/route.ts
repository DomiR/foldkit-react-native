import { Schema, pipe } from 'effect'
import { Route } from 'foldkit'
import { defineRouteUnion, literal, slash } from 'foldkit/route'

export const AppRoute = defineRouteUnion({
  Examples: {},
  Counter: {},
  Stopwatch: {},
  Todo: {},
  Form: {},
  Gestures: {},
  Animations: {},
  NotFound: { path: Schema.String },
})

export type AppRoute = typeof AppRoute.Type

export const examplesRouter = pipe(
  literal('examples'),
  Route.mapTo(AppRoute.Examples),
)

export const counterRouter = pipe(
  literal('examples'),
  slash(literal('counter')),
  Route.mapTo(AppRoute.Counter),
)

export const stopwatchRouter = pipe(
  literal('examples'),
  slash(literal('stopwatch')),
  Route.mapTo(AppRoute.Stopwatch),
)

export const todoRouter = pipe(
  literal('examples'),
  slash(literal('todo')),
  Route.mapTo(AppRoute.Todo),
)

export const formRouter = pipe(
  literal('examples'),
  slash(literal('form')),
  Route.mapTo(AppRoute.Form),
)

export const gesturesRouter = pipe(
  literal('gestures'),
  Route.mapTo(AppRoute.Gestures),
)

export const animationsRouter = pipe(
  literal('animations'),
  Route.mapTo(AppRoute.Animations),
)

const rootRouter = pipe(Route.root, Route.mapTo(AppRoute.Examples))

const routeParser = Route.oneOf(
  counterRouter,
  stopwatchRouter,
  todoRouter,
  formRouter,
  examplesRouter,
  gesturesRouter,
  animationsRouter,
  rootRouter,
)

export const urlToAppRoute = Route.parseUrlWithFallback(
  routeParser,
  AppRoute.NotFound,
)

export const appRouteToUrl = (appRoute: AppRoute): string =>
  AppRoute.match<string>(appRoute, {
    Examples: () => examplesRouter(),
    Counter: () => counterRouter(),
    Stopwatch: () => stopwatchRouter(),
    Todo: () => todoRouter(),
    Form: () => formRouter(),
    Gestures: () => gesturesRouter(),
    Animations: () => animationsRouter(),
    NotFound: () => examplesRouter(),
  })
