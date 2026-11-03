import type { StrictStyle, StrictView } from 'foldkit/strict'

import { Message, type Model } from './program'

const buttonStyle: StrictStyle = {
  backgroundColor: '#182c25',
  color: '#ffffff',
  paddingHorizontal: 24,
  paddingVertical: 12,
  borderRadius: 8,
  fontSize: 18,
  textAlign: 'center',
}

export const strictView: StrictView<Model, Message> = (model, h) =>
  h.div(
    [h.Style({ gap: 24, padding: 24, alignItems: 'center' })],
    [
      h.h1(
        [h.Style({ fontSize: 28, fontWeight: 'bold', color: '#182c25' })],
        ['Counter'],
      ),
      h.p(
        [
          h.Style({ fontSize: 72, fontWeight: 'bold', color: '#182c25' }),
          h.AriaLabel(`Count: ${model.count}`),
        ],
        [model.count.toString()],
      ),
      h.div(
        [h.Style({ flexDirection: 'row', gap: 12 })],
        [
          h.button(
            [
              h.Style(buttonStyle),
              h.AriaLabel('Decrement'),
              h.OnClick(Message.ClickedDecrement()),
            ],
            ['−'],
          ),
          h.button(
            [h.Style(buttonStyle), h.OnClick(Message.ClickedReset())],
            ['Reset'],
          ),
          h.button(
            [
              h.Style(buttonStyle),
              h.AriaLabel('Increment'),
              h.OnClick(Message.ClickedIncrement()),
            ],
            ['+'],
          ),
        ],
      ),
    ],
  )
