import { Option } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { fromString } from 'foldkit/url'
import * as Todo from 'todo-example/program'
import { describe, expect, test } from 'vitest'

import {
  Message,
  PushUrl,
  ReplaceUrl,
  ShowcaseRoute,
  init,
  update,
} from './showcase'

const urlOrThrow = (raw: string) =>
  Option.getOrThrowWith(
    fromString(raw),
    () => new Error(`Failed to parse url: ${raw}`),
  )

const flags = Todo.Flags.make({ todos: Option.none() })
const rootUrl = urlOrThrow('http://localhost/')
const counterUrl = urlOrThrow('http://localhost/examples/counter')
const contactsUrl = urlOrThrow('http://localhost/examples/contacts')
const chatUrl = urlOrThrow('http://localhost/examples/chat')
const gesturesUrl = urlOrThrow('http://localhost/gestures')
const notFoundUrl = urlOrThrow('http://localhost/nope')
const initialModel = init(flags, rootUrl).model
const counterModel = modifyFields(initialModel, {
  stack: () => [
    ShowcaseRoute.Home({ id: 0 }),
    ShowcaseRoute.Counter({ id: 1 }),
  ],
  nextScreenId: () => 2,
})

describe('routing', () => {
  test('initializes the Counter route from the URL', () => {
    const counterInit = init(flags, counterUrl)

    expect(counterInit.model.tabs).toBe('Examples')
    expect(counterInit.model.stack).toStrictEqual([
      ShowcaseRoute.Home({ id: 0 }),
      ShowcaseRoute.Counter({ id: 1 }),
    ])
    expect(counterInit.model.nextScreenId).toBe(2)
  })

  test('initializes the Contacts route from the URL', () => {
    const contactsInit = init(flags, contactsUrl)

    expect(contactsInit.model.tabs).toBe('Examples')
    expect(contactsInit.model.stack).toStrictEqual([
      ShowcaseRoute.Home({ id: 0 }),
      ShowcaseRoute.Contacts({ id: 1 }),
    ])
    expect(contactsInit.model.nextScreenId).toBe(2)
  })

  test('initializes the Chat route from the URL', () => {
    const chatInit = init(flags, chatUrl)

    expect(chatInit.model.tabs).toBe('Examples')
    expect(chatInit.model.stack).toStrictEqual([
      ShowcaseRoute.Home({ id: 0 }),
      ShowcaseRoute.Chat({ id: 1 }),
    ])
    expect(chatInit.model.nextScreenId).toBe(2)
  })

  test('does not change the Model or emit a Command for the current URL', () => {
    story(
      update,
      given(counterModel),
      message(Message.ChangedUrl({ url: counterUrl })),
      model(nextModel => {
        expect(nextModel).toStrictEqual(counterModel)
      }),
      Command.expectNone(),
    )
  })

  test('changes to Gestures without changing the stack', () => {
    story(
      update,
      given(counterModel),
      message(Message.ChangedUrl({ url: gesturesUrl })),
      model(nextModel => {
        expect(nextModel.tabs).toBe('Gestures')
        expect(nextModel.stack).toStrictEqual(counterModel.stack)
      }),
      Command.expectNone(),
    )
  })

  test('pushes the Todo URL when opening a Todo example', () => {
    story(
      update,
      given(initialModel),
      message(Message.PressedExampleRow({ example: 'Todo' })),
      Command.expectHas(PushUrl({ url: '/examples/todo' })),
      Command.resolve(PushUrl, Message.CompletedPushUrl()),
    )
  })

  test('replaces the URL when dismissing the Counter screen', () => {
    story(
      update,
      given(counterModel),
      message(Message.DismissedScreens({ dismissedCount: 1 })),
      Command.expectHas(ReplaceUrl({ url: '/examples' })),
      Command.resolve(ReplaceUrl, Message.CompletedReplaceUrl()),
    )
  })

  test('leaves the Model unchanged for an unknown URL', () => {
    story(
      update,
      given(initialModel),
      message(Message.ChangedUrl({ url: notFoundUrl })),
      model(nextModel => {
        expect(nextModel).toStrictEqual(initialModel)
      }),
      Command.expectNone(),
    )
  })
})
