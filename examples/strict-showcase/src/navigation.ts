import { Context, Effect, Layer } from 'effect'
import { pushUrl, replaceUrl } from 'foldkit/navigation'

export class ShowcaseNavigation extends Context.Service<
  ShowcaseNavigation,
  Readonly<{
    pushUrl: (url: string) => Effect.Effect<void>
    replaceUrl: (url: string) => Effect.Effect<void>
  }>
>()('strict-showcase/ShowcaseNavigation') {}

export const webShowcaseNavigation = Layer.succeed(ShowcaseNavigation, {
  pushUrl,
  replaceUrl,
})

export const nativeShowcaseNavigation = Layer.succeed(ShowcaseNavigation, {
  pushUrl: () => Effect.void,
  replaceUrl: () => Effect.void,
})
