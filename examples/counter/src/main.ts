import { Document, HtmlBuilder } from 'foldkit/html'

import { Button } from '@foldkit/ui'

import { Message, Model } from './program'

export { Message, Model, init, update } from './program'

// VIEW

export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: `Counter: ${model.count}`,
  body: h.div(
    [
      h.Class(
        'min-h-screen bg-white flex flex-col items-center justify-center gap-6 p-6',
      ),
    ],
    [
      h.p(
        [h.Class('text-6xl font-bold text-gray-800')],
        [model.count.toString()],
      ),
      h.div(
        [h.Class('flex flex-wrap justify-center gap-4')],
        [
          Button.view(
            {
              onClick: Message.ClickedDecrement(),
              toView: attributes =>
                h.button([...attributes.button, h.Class(buttonStyle)], ['-']),
            },
            h,
          ),
          Button.view(
            {
              onClick: Message.ClickedReset(),
              toView: attributes =>
                h.button(
                  [...attributes.button, h.Class(buttonStyle)],
                  ['Reset'],
                ),
            },
            h,
          ),
          Button.view(
            {
              onClick: Message.ClickedIncrement(),
              toView: attributes =>
                h.button([...attributes.button, h.Class(buttonStyle)], ['+']),
            },
            h,
          ),
        ],
      ),
    ],
  ),
})

// STYLE

const buttonStyle = 'bg-black text-white hover:bg-gray-700 px-4 py-2 transition'
