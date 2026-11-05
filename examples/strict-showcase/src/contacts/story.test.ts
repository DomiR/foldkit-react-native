import { Array, Option } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import {
  INITIAL_CONTACTS,
  LoadContactsPage,
  Message,
  PAGE_SIZE,
  PageState,
  TOTAL_CONTACTS,
  contactsInRange,
  init,
  update,
} from './program'

const initialModel = init().model

describe('update', () => {
  test('ReachedContactsEnd while Idle loads the next page', () => {
    story(
      update,
      given(initialModel),
      message(Message.ReachedContactsEnd()),
      Command.expectHas(LoadContactsPage({ start: INITIAL_CONTACTS })),
      Command.resolve(
        LoadContactsPage({ start: INITIAL_CONTACTS }),
        Message.CompletedLoadContactsPage({
          contacts: contactsInRange(INITIAL_CONTACTS, PAGE_SIZE),
        }),
      ),
      model(model => {
        expect(model.contacts).toHaveLength(INITIAL_CONTACTS + PAGE_SIZE)
        expect(model.page).toStrictEqual(PageState.Idle())
      }),
    )
  })

  test('ReachedContactsEnd while Loading does nothing', () => {
    const loadingModel = modifyFields(initialModel, {
      page: () => PageState.Loading(),
    })

    story(
      update,
      given(loadingModel),
      message(Message.ReachedContactsEnd()),
      Command.expectNone(),
      model(model => {
        expect(model).toBe(loadingModel)
      }),
    )
  })

  test('CompletedLoadContactsPage appends a page and returns to Idle', () => {
    const loadedContacts = contactsInRange(INITIAL_CONTACTS, PAGE_SIZE)

    story(
      update,
      given(initialModel),
      message(Message.CompletedLoadContactsPage({ contacts: loadedContacts })),
      model(model => {
        expect(model.contacts).toHaveLength(INITIAL_CONTACTS + PAGE_SIZE)
        expect(model.page).toStrictEqual(PageState.Idle())
      }),
    )
  })

  test('reaching the total marks the page Complete and stops later loads', () => {
    const almostCompleteModel = modifyFields(initialModel, {
      contacts: () => contactsInRange(0, TOTAL_CONTACTS - PAGE_SIZE),
    })

    story(
      update,
      given(almostCompleteModel),
      message(
        Message.CompletedLoadContactsPage({
          contacts: contactsInRange(TOTAL_CONTACTS - PAGE_SIZE, PAGE_SIZE),
        }),
      ),
      model(model => {
        expect(model.contacts).toHaveLength(TOTAL_CONTACTS)
        expect(model.page).toStrictEqual(PageState.Complete())
      }),
      message(Message.ReachedContactsEnd()),
      Command.expectNone(),
    )
  })

  test('PressedContact toggles one favorite', () => {
    story(
      update,
      given(initialModel),
      message(Message.PressedContact({ contactId: 'contact-7' })),
      model(model => {
        const maybeContact = Array.findFirst(
          model.contacts,
          contact => contact.id === 'contact-7',
        )
        expect(
          Option.map(maybeContact, contact => contact.isFavorite),
        ).toStrictEqual(Option.some(true))
      }),
    )
  })
})
