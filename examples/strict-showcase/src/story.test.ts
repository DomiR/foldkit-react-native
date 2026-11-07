import { Effect, Option } from 'effect'
import { Story } from 'foldkit'
import { fromString } from 'foldkit/url'
import { describe, expect, test } from 'vitest'

import { makeShowcaseLayer } from './layer'
import {
  Message,
  PushUrl,
  ReplaceUrl,
  ShowcaseBlock,
  ShowcaseRoute,
} from './showcase'

const urlOrThrow = (raw: string) =>
  Option.getOrThrowWith(
    fromString(raw),
    () => new Error(`Failed to parse url: ${raw}`),
  )

const rootUrl = urlOrThrow('http://localhost/')
const counterUrl = urlOrThrow('http://localhost/examples/counter')
const contactsUrl = urlOrThrow('http://localhost/examples/contacts')
const chatUrl = urlOrThrow('http://localhost/examples/chat')
const gesturesUrl = urlOrThrow('http://localhost/gestures')
const notFoundUrl = urlOrThrow('http://localhost/nope')

const showcase = { block: ShowcaseBlock, layer: makeShowcaseLayer() }

const exampleStack = (route: ShowcaseRoute) => [
  ShowcaseRoute.Home({ id: 0 }),
  route,
]

describe('routing', () => {
  test('initializes the Counter route from the URL', () =>
    Effect.runPromise(
      Story.story(
        showcase,
        Story.init(counterUrl),
        Story.model(model => {
          expect(model.tabs).toBe('Examples')
          expect(model.stack).toStrictEqual(
            exampleStack(ShowcaseRoute.Counter({ id: 1 })),
          )
          expect(model.nextScreenId).toBe(2)
          expect(model.counter).toStrictEqual({ count: 0 })
        }),
      ),
    ))

  test('initializes the Contacts route from the URL', () =>
    Effect.runPromise(
      Story.story(
        showcase,
        Story.init(contactsUrl),
        Story.model(model => {
          expect(model.stack).toStrictEqual(
            exampleStack(ShowcaseRoute.Contacts({ id: 1 })),
          )
        }),
      ),
    ))

  test('initializes the Chat route from the URL', () =>
    Effect.runPromise(
      Story.story(
        showcase,
        Story.init(chatUrl),
        Story.model(model => {
          expect(model.stack).toStrictEqual(
            exampleStack(ShowcaseRoute.Chat({ id: 1 })),
          )
        }),
      ),
    ))

  test('does not change the stack or emit a Command for the current URL', () =>
    Effect.runPromise(
      Story.story(
        showcase,
        Story.init(counterUrl),
        Story.message(Message.ChangedUrl({ url: counterUrl })),
        Story.model(model => {
          expect(model.stack).toStrictEqual(
            exampleStack(ShowcaseRoute.Counter({ id: 1 })),
          )
        }),
        Story.Command.expectNone(),
      ),
    ))

  test('changes to Gestures without changing the stack', () =>
    Effect.runPromise(
      Story.story(
        showcase,
        Story.init(counterUrl),
        Story.message(Message.ChangedUrl({ url: gesturesUrl })),
        Story.model(model => {
          expect(model.tabs).toBe('Gestures')
          expect(model.stack).toStrictEqual(
            exampleStack(ShowcaseRoute.Counter({ id: 1 })),
          )
        }),
        Story.Command.expectNone(),
      ),
    ))

  test('pushes the Todo URL when opening a Todo example', () =>
    Effect.runPromise(
      Story.story(
        showcase,
        Story.init(rootUrl),
        Story.message(Message.PressedExampleRow({ example: 'Todo' })),
        Story.Command.expectExact(PushUrl({ url: '/examples/todo' })),
        Story.Command.resolve(
          PushUrl({ url: '/examples/todo' }),
          Message.CompletedPushUrl(),
        ),
      ),
    ))

  test('replaces the URL when dismissing the Counter screen', () =>
    Effect.runPromise(
      Story.story(
        showcase,
        Story.init(counterUrl),
        Story.message(Message.DismissedScreens({ dismissedCount: 1 })),
        Story.Command.expectExact(ReplaceUrl({ url: '/examples' })),
        Story.Command.resolve(
          ReplaceUrl({ url: '/examples' }),
          Message.CompletedReplaceUrl(),
        ),
      ),
    ))

  test('leaves the stack unchanged for an unknown URL', () =>
    Effect.runPromise(
      Story.story(
        showcase,
        Story.init(rootUrl),
        Story.message(Message.ChangedUrl({ url: notFoundUrl })),
        Story.model(model => {
          expect(model.stack).toStrictEqual([ShowcaseRoute.Home({ id: 0 })])
        }),
        Story.Command.expectNone(),
      ),
    ))
})
