import { Array, Duration, Effect, Option, Schema } from 'effect'
import { Block } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'

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

// MODEL

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

// MESSAGE

export const Message = defineMessageUnion({
  PressedContact: { contactId: Schema.String },
  ReachedContactsEnd: {},
  CompletedLoadContactsPage: { contacts: Schema.Array(Contact) },
})
export type Message = typeof Message.Type

// BLOCK

export const ContactsKey = Symbol('Contacts')
export const ContactsBlock = Block.make('Contacts', {
  key: ContactsKey,
  InitArgs: Schema.Tuple([]),
  view: { kind: 'Element' },
  Model,
  Message,
})

const { makeCommand, makeComposition, makeFieldsStep, makeNoopStep, makeStep } =
  ContactsBlock

export const ContactsComposition = makeComposition()

// COMMAND

export const LoadContactsPage = makeCommand('LoadContactsPage', {
  args: { start: Schema.Number },
  messages: [Message.CompletedLoadContactsPage],
  handler: function* () {
    return ({ start }) =>
      Effect.sleep(Duration.millis(PAGE_DELAY_MS)).pipe(
        Effect.as(
          Message.CompletedLoadContactsPage({
            contacts: contactsInRange(start, PAGE_SIZE),
          }),
        ),
      )
  },
})

export const EffectsLayer = LoadContactsPage.layer

// INIT

export const init = ContactsComposition.makeInit(() => ({
  model: {
    contacts: contactsInRange(0, INITIAL_CONTACTS),
    page: PageState.Idle(),
  },
}))

// UPDATE

const keepModel = makeNoopStep()

const loadNextPage = makeStep(model => {
  if (model.contacts.length >= TOTAL_CONTACTS) {
    return { model }
  }

  return {
    model: modifyFields(model, {
      page: () => PageState.Loading(),
    }),
    commands: [LoadContactsPage({ start: model.contacts.length })],
  }
})

export const update = ContactsComposition.makeUpdate({
  PressedContact: makeFieldsStep.fromMessage(({ contactId }) => ({
    contacts: Array.map(contact =>
      contact.id === contactId
        ? modifyFields(contact, {
            isFavorite: isFavorite => !isFavorite,
          })
        : contact,
    ),
  })),

  ReachedContactsEnd: makeStep(model =>
    PageState.match(model.page, {
      Idle: () => loadNextPage,
      Loading: () => keepModel,
      Complete: () => keepModel,
    }),
  ),

  CompletedLoadContactsPage: makeStep.fromMessage(
    ({ contacts: loadedContacts }) =>
      makeStep(model => {
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
      }),
  ),
})
