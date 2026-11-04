import { Array, String, pipe } from 'effect'
import type { StrictView } from 'foldkit/strict'

import {
  type Contact,
  Message,
  type Model,
  PageState,
  TOTAL_CONTACTS,
} from './program'

const CONTACT_ROW_HEIGHT = 64

const contactInitials = (contact: Contact): string =>
  pipe(
    contact.name,
    String.split(' '),
    Array.take(2),
    Array.map(String.slice(0, 1)),
    Array.join(''),
  )

export const strictView: StrictView<Model, Message> = (model, h) => {
  const totalContacts = TOTAL_CONTACTS.toLocaleString('en-US')
  const loadingSuffix = PageState.match(model.page, {
    Idle: () => '',
    Loading: () => ' · Loading more…',
    Complete: () => '',
  })
  const status = h.p(
    [h.Style({ padding: 16, color: '#627a6c' })],
    [
      `${model.contacts.length.toLocaleString('en-US')} of ${totalContacts} contacts${loadingSuffix}`,
    ],
  )
  const contactRow = (contact: Contact, index: number) =>
    h.button(
      [
        h.OnClick(Message.PressedContact({ contactId: contact.id })),
        h.AriaLabel(contact.name),
        h.Style({
          height: CONTACT_ROW_HEIGHT,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingHorizontal: 16,
          backgroundColor: index % 2 === 0 ? '#f1f4ef' : '#e7eee7',
          color: '#182c25',
        }),
      ],
      [
        h.div(
          [
            h.Style({
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: '#182c25',
              color: '#f1f4ef',
              alignItems: 'center',
              justifyContent: 'center',
            }),
          ],
          [contactInitials(contact)],
        ),
        h.div(
          [h.Style({ flex: 1, gap: 2 })],
          [
            h.p(
              [h.Style({ color: '#182c25', fontWeight: 'bold' })],
              [contact.name],
            ),
            h.p([h.Style({ color: '#627a6c' })], [contact.phone]),
          ],
        ),
        h.span(
          [h.Style({ color: '#182c25', fontSize: 24 })],
          [contact.isFavorite ? '★' : '☆'],
        ),
      ],
    )
  const list = h.list(
    [
      h.OnEndReached(Message.ReachedContactsEnd()),
      h.Style({ flex: 1 }),
      h.AriaLabel('Contacts'),
    ],
    {
      items: model.contacts,
      key: contact => contact.id,
      view: contactRow,
      itemHeight: CONTACT_ROW_HEIGHT,
    },
  )

  return h.div([h.Style({ flex: 1, minHeight: 0 })], [status, list])
}
