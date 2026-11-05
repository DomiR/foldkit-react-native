import { Array, Duration, Effect, Option, Schema } from 'effect'
import * as Command from 'foldkit/command'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import type * as Update from 'foldkit/update'

export const TOTAL_CONTACTS = 10000
export const INITIAL_CONTACTS = 5000
export const PAGE_SIZE = 1000
export const PAGE_DELAY_MS = 400

const FIRST_NAMES: ReadonlyArray<string> = [
  'Ada',
  'Amir',
  'Bea',
  'Cam',
  'Dara',
  'Elio',
  'Farah',
  'Grace',
  'Hana',
  'Ivan',
]
const LAST_NAMES: ReadonlyArray<string> = [
  'Alvarez',
  'Bennett',
  'Chen',
  'Davis',
  'Evans',
  'Foster',
  'Garcia',
  'Hughes',
  'Ibrahim',
  'Jones',
]

export const Contact = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  phone: Schema.String,
  isFavorite: Schema.Boolean,
})
export type Contact = typeof Contact.Type

export const contactAt = (index: number): Contact => {
  const firstName = Option.getOrElse(
    Array.get(FIRST_NAMES, index % Array.length(FIRST_NAMES)),
    () => 'Alex',
  )
  const lastName = Option.getOrElse(
    Array.get(
      LAST_NAMES,
      Math.floor(index / Array.length(FIRST_NAMES)) % Array.length(LAST_NAMES),
    ),
    () => 'Morgan',
  )

  return Contact.make({
    id: `contact-${index}`,
    name: `${firstName} ${lastName}`,
    phone: `(555) 010-${index.toString().padStart(4, '0')}`,
    isFavorite: false,
  })
}

export const contactsInRange = (start: number, count: number) => {
  const clampedStart = Math.max(0, Math.min(Math.floor(start), TOTAL_CONTACTS))
  const clampedCount = Math.max(
    0,
    Math.min(Math.floor(count), TOTAL_CONTACTS - clampedStart),
  )

  return Array.makeBy(clampedCount, index => contactAt(clampedStart + index))
}

export const PageState = defineTaggedUnion({
  Idle: {},
  Loading: {},
  Complete: {},
})
export type PageState = typeof PageState.Type

export const Model = Schema.Struct({
  contacts: Schema.Array(Contact),
  page: PageState,
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
  PressedContact: { contactId: Schema.String },
  ReachedContactsEnd: {},
  CompletedLoadContactsPage: { contacts: Schema.Array(Contact) },
})
export type Message = typeof Message.Type

export const LoadContactsPage = Command.define('LoadContactsPage', {
  args: { start: Schema.Number },
  messages: [Message.CompletedLoadContactsPage],
  execute: ({ start }) =>
    Effect.sleep(Duration.millis(PAGE_DELAY_MS)).pipe(
      Effect.as(
        Message.CompletedLoadContactsPage({
          contacts: contactsInRange(start, PAGE_SIZE),
        }),
      ),
    ),
})

export const init = (): Update.Return<Model, Message> => ({
  model: Model.make({
    contacts: contactsInRange(0, INITIAL_CONTACTS),
    page: PageState.Idle(),
  }),
})

export const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message>>(message, {
    PressedContact: ({ contactId }) => ({
      model: modifyFields(model, {
        contacts: Array.map(contact =>
          contact.id === contactId
            ? modifyFields(contact, {
                isFavorite: isFavorite => !isFavorite,
              })
            : contact,
        ),
      }),
    }),
    ReachedContactsEnd: () =>
      PageState.match(model.page, {
        Idle: () => {
          if (model.contacts.length >= TOTAL_CONTACTS) {
            return { model }
          } else {
            return {
              model: modifyFields(model, {
                page: () => PageState.Loading(),
              }),
              commands: [LoadContactsPage({ start: model.contacts.length })],
            }
          }
        },
        Loading: () => ({ model }),
        Complete: () => ({ model }),
      }),
    CompletedLoadContactsPage: ({ contacts: loadedContacts }) => {
      const nextContacts = Array.appendAll(model.contacts, loadedContacts)
      const nextPage =
        nextContacts.length >= TOTAL_CONTACTS
          ? PageState.Complete()
          : PageState.Idle()

      return {
        model: modifyFields(model, {
          contacts: () => nextContacts,
          page: () => nextPage,
        }),
      }
    },
  })
