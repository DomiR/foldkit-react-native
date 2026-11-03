import { Document, Html, HtmlBuilder } from 'foldkit/html'

import { Button } from '@foldkit/ui'

import { Message, type Model, formatTime } from './program'

export {
  DetermineStartTime,
  DetermineTickTime,
  Message,
  Model,
  init,
  subscriptions,
  update,
} from './program'

// VIEW

export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: `Stopwatch ${formatTime(model.elapsedMs)}`,
  body: h.div(
    [h.Class('min-h-screen bg-gray-200 flex items-center justify-center')],
    [
      h.div(
        [h.Class('bg-white text-center')],
        [
          h.div(
            [h.Class('text-6xl font-mono font-bold text-gray-800 p-8')],
            [formatTime(model.elapsedMs)],
          ),
          h.div(
            [h.Class('flex')],
            [
              Button.view(
                {
                  onClick: Message.ClickedReset(),
                  toView: attributes =>
                    h.button(
                      [
                        ...attributes.button,
                        h.Class(buttonStyle + ' bg-gray-500 hover:bg-gray-600'),
                      ],
                      ['Reset'],
                    ),
                },
                h,
              ),
              startStopButton(model.isRunning, h),
            ],
          ),
        ],
      ),
    ],
  ),
})

const startStopButton = (isRunning: boolean, h: HtmlBuilder<Message>): Html =>
  isRunning
    ? Button.view(
        {
          onClick: Message.ClickedStop(),
          toView: attributes =>
            h.button(
              [
                ...attributes.button,
                h.Class(buttonStyle + ' bg-red-500 hover:bg-red-600'),
              ],
              ['Stop'],
            ),
        },
        h,
      )
    : Button.view(
        {
          onClick: Message.ClickedStart(),
          toView: attributes =>
            h.button(
              [
                ...attributes.button,
                h.Class(buttonStyle + ' bg-green-500 hover:bg-green-600'),
              ],
              ['Start'],
            ),
        },
        h,
      )

// STYLE

const buttonStyle =
  'px-6 py-4 flex-1 font-semibold text-white transition-colors'
