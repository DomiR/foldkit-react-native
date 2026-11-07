import { Array, Effect, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import {
  ContactsBlock,
  INITIAL_CONTACTS,
  LoadContactsPage,
  Message,
  Model,
  PAGE_SIZE,
  PageState,
  TOTAL_CONTACTS,
  contactsInRange,
} from './block'
import { layer } from './layer'

const initialModel = Model.make({
  contacts: contactsInRange(0, INITIAL_CONTACTS),
  page: PageState.Idle(),
})

describe('update', () => {
  test('init starts Idle with the initial contacts', () =>
    Effect.runPromise(
      Story.story(
        { block: ContactsBlock, layer },
        Story.init(),
        Story.Command.expectNone(),
        Story.model(model => {
          expect(model.contacts).toHaveLength(INITIAL_CONTACTS)
          expect(model.page).toStrictEqual(PageState.Idle())
        }),
      ),
    ))

  test('ReachedContactsEnd while Idle loads the next page', () =>
    Effect.runPromise(
      Story.story(
        { block: ContactsBlock, layer },
        Story.given(initialModel),
        Story.message(Message.ReachedContactsEnd()),
        Story.Command.expectExact(
          LoadContactsPage({ start: INITIAL_CONTACTS }),
        ),
        Story.model(model => {
          expect(model.page).toStrictEqual(PageState.Loading())
        }),
        Story.Command.resolve(
          LoadContactsPage({ start: INITIAL_CONTACTS }),
          Message.CompletedLoadContactsPage({
            contacts: contactsInRange(INITIAL_CONTACTS, PAGE_SIZE),
          }),
        ),
        Story.model(model => {
          expect(model.contacts).toHaveLength(INITIAL_CONTACTS + PAGE_SIZE)
          expect(model.page).toStrictEqual(PageState.Idle())
        }),
      ),
    ))

  test('ReachedContactsEnd while Loading does nothing', () => {
    const loadingModel = modifyFields(initialModel, {
      page: () => PageState.Loading(),
    })

    return Effect.runPromise(
      Story.story(
        { block: ContactsBlock, layer },
        Story.given(loadingModel),
        Story.message(Message.ReachedContactsEnd()),
        Story.Command.expectNone(),
        Story.model(model => {
          expect(model).toStrictEqual(loadingModel)
        }),
      ),
    )
  })

  test('CompletedLoadContactsPage appends a page and returns to Idle', () => {
    const loadingModel = modifyFields(initialModel, {
      page: () => PageState.Loading(),
    })

    return Effect.runPromise(
      Story.story(
        { block: ContactsBlock, layer },
        Story.given(loadingModel),
        Story.message(
          Message.CompletedLoadContactsPage({
            contacts: contactsInRange(INITIAL_CONTACTS, PAGE_SIZE),
          }),
        ),
        Story.model(model => {
          expect(model.contacts).toHaveLength(INITIAL_CONTACTS + PAGE_SIZE)
          expect(model.page).toStrictEqual(PageState.Idle())
        }),
      ),
    )
  })

  test('reaching the total marks the page Complete and stops later loads', () => {
    const almostCompleteModel = modifyFields(initialModel, {
      contacts: () => contactsInRange(0, TOTAL_CONTACTS - PAGE_SIZE),
      page: () => PageState.Loading(),
    })

    return Effect.runPromise(
      Story.story(
        { block: ContactsBlock, layer },
        Story.given(almostCompleteModel),
        Story.message(
          Message.CompletedLoadContactsPage({
            contacts: contactsInRange(TOTAL_CONTACTS - PAGE_SIZE, PAGE_SIZE),
          }),
        ),
        Story.model(model => {
          expect(model.contacts).toHaveLength(TOTAL_CONTACTS)
          expect(model.page).toStrictEqual(PageState.Complete())
        }),
        Story.message(Message.ReachedContactsEnd()),
        Story.Command.expectNone(),
      ),
    )
  })

  test('PressedContact toggles one favorite', () =>
    Effect.runPromise(
      Story.story(
        { block: ContactsBlock, layer },
        Story.given(initialModel),
        Story.message(Message.PressedContact({ contactId: 'contact-7' })),
        Story.model(model => {
          const maybeContact = Array.findFirst(
            model.contacts,
            contact => contact.id === 'contact-7',
          )
          expect(
            Option.map(maybeContact, contact => contact.isFavorite),
          ).toStrictEqual(Option.some(true))
        }),
        Story.message(Message.PressedContact({ contactId: 'contact-7' })),
        Story.model(model => {
          expect(
            Array.filter(model.contacts, contact => contact.isFavorite),
          ).toHaveLength(0)
        }),
      ),
    ))
})
