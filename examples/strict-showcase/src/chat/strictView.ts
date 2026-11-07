import { String } from 'effect'
import type { StrictStyle, StrictView } from 'foldkit/strict'

import { Message, type ChatEntry, type Model } from './block'

const buttonStyle: StrictStyle = {
  backgroundColor: '#182c25',
  color: '#ffffff',
  paddingHorizontal: 14,
  paddingVertical: 10,
  borderRadius: 8,
  textAlign: 'center',
}
const inputStyle: StrictStyle = {
  flex: 1,
  minWidth: 0,
  backgroundColor: '#ffffff',
  color: '#182c25',
  borderWidth: 1,
  borderColor: '#acbab2',
  borderRadius: 8,
  paddingHorizontal: 12,
  paddingVertical: 10,
  fontSize: 16,
}

export const strictView: StrictView<Model, Message> = (model, h) => {
  const messageBubble = (entry: ChatEntry) =>
    h.div(
      [
        h.Style({
          alignSelf: 'flex-start',
          maxWidth: '90%',
          padding: 12,
          borderRadius: 12,
          backgroundColor: '#e7eee7',
          color: '#182c25',
        }),
      ],
      [h.p([], [entry.text])],
    )
  const list = h.list(
    [h.AriaLabel('Messages'), h.Style({ flex: 1, minHeight: 0 })],
    {
      items: model.messages,
      key: entry => entry.id,
      view: entry => messageBubble(entry),
      maintainVisibleContentPosition: true,
    },
  )
  const footer = h.stickyFooter(
    [
      h.Style({
        flexDirection: 'row',
        gap: 10,
        padding: 12,
        backgroundColor: '#ffffff',
      }),
    ],
    [
      h.input([
        h.AriaLabel('Message'),
        h.Placeholder('Message'),
        h.Value(model.draft),
        h.OnInput(text => Message.UpdatedDraft({ text })),
        h.OnSubmitEditing(Message.SubmittedDraft()),
        h.Style(inputStyle),
      ]),
      h.button(
        [
          h.Style(buttonStyle),
          h.Disabled(String.isEmpty(String.trim(model.draft))),
          h.OnClick(Message.SubmittedDraft()),
        ],
        ['Send'],
      ),
    ],
  )

  return h.div([h.Style({ flex: 1, minHeight: 0 })], [list, footer])
}
