import type { StrictStyle, StrictView } from 'foldkit/strict'

import { Message, type Model, formatTime } from './block'

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
        ['Stopwatch'],
      ),
      h.p(
        [h.Style({ fontSize: 44, fontWeight: 'bold', color: '#182c25' })],
        [formatTime(model.elapsedMs)],
      ),
      h.div(
        [h.Style({ flexDirection: 'row', gap: 12 })],
        [
          h.button(
            [h.Style(buttonStyle), h.OnClick(Message.ClickedReset())],
            ['Reset'],
          ),
          h.button(
            [
              h.Style(buttonStyle),
              h.OnClick(
                model.isRunning
                  ? Message.ClickedStop()
                  : Message.ClickedStart(),
              ),
            ],
            [model.isRunning ? 'Stop' : 'Start'],
          ),
        ],
      ),
    ],
  )
