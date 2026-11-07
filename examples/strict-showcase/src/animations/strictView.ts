import { Array } from 'effect'
import {
  FadeIn,
  FadeOut,
  Pan,
  SlideInRight,
  type StrictStyle,
  type StrictView,
} from 'foldkit/strict'

import { Message, type Model, PrimeState, cardOffset } from './block'

const CARD_STYLE: StrictStyle = {
  minHeight: 140,
  padding: 24,
  gap: 8,
  borderRadius: 16,
  backgroundColor: '#182c25',
  color: '#ffffff',
  justifyContent: 'center',
  alignItems: 'center',
}
const BUTTON_STYLE: StrictStyle = {
  padding: 14,
  borderRadius: 10,
  backgroundColor: '#dce5df',
  color: '#182c25',
  fontSize: 16,
}
const TRANSITION_MS = 450

const cardStyle = (value: number): StrictStyle => {
  'worklet'
  return { transform: [{ translateX: value }] }
}

export const strictView: StrictView<Model, Message> = (model, h) => {
  const isExpanded = model.box === 'Expanded'
  const isCounting = model.primes._tag === 'Running'
  const primeStatus = PrimeState.match(model.primes, {
    Idle: () =>
      h.p([], ['Count primes up to 2,000,000 on the background runtime.']),
    Running: ({ angle }) =>
      h.div(
        [h.Style({ flexDirection: 'row', gap: 12, alignItems: 'center' })],
        [
          h.div([
            h.AriaLabel('Counting primes'),
            h.Style({
              width: 24,
              height: 24,
              borderWidth: 5,
              borderColor: '#bb753e',
              borderRadius: 6,
              transform: [{ rotate: `${angle}deg` }],
              transitionProperty: 'transform',
              transitionDuration: 120,
              transitionTimingFunction: 'linear',
            }),
          ]),
          h.p([], ['Computing. Try toggling the box or dragging the card.']),
        ],
      ),
    Succeeded: ({ count, elapsedMs }) =>
      h.p(
        [],
        [`${count.toLocaleString()} primes · ${elapsedMs.toFixed(0)} ms`],
      ),
    Failed: ({ reason }) => h.p([h.Style({ color: '#b42318' })], [reason]),
  })

  return h.div(
    [h.Style({ padding: 24, gap: 24, color: '#182c25' })],
    [
      h.h1([h.Style({ fontSize: 28, fontWeight: 'bold' })], ['Animations']),
      h.h2(
        [h.Style({ fontSize: 20, fontWeight: 'bold' })],
        ['Model transitions'],
      ),
      h.button(
        [h.OnClick(Message.ClickedToggleBox()), h.Style(BUTTON_STYLE)],
        ['Toggle box'],
      ),
      h.div([
        h.OnTransitionEnd(Message.EndedBoxTransition()),
        h.Style({
          width: isExpanded ? 200 : 100,
          height: isExpanded ? 120 : 72,
          backgroundColor: isExpanded ? '#bb753e' : '#5e8c73',
          borderRadius: 16,
          transform: [{ translateX: isExpanded ? 50 : 0 }],
          transitionProperty: [
            'width',
            'height',
            'backgroundColor',
            'transform',
          ],
          transitionDuration: TRANSITION_MS,
          transitionTimingFunction: 'ease-in-out',
        }),
      ]),
      h.p(
        [],
        [`Completed property transitions: ${model.completedTransitions}`],
      ),
      h.h2(
        [h.Style({ fontSize: 20, fontWeight: 'bold' })],
        ['Entering and exiting'],
      ),
      h.button(
        [h.OnClick(Message.ClickedAddItem()), h.Style(BUTTON_STYLE)],
        ['Add item'],
      ),
      h.ul(
        [h.Style({ gap: 10 })],
        Array.map(model.items, item =>
          h.keyed('li')(
            item.id.toString(),
            [
              h.Entering(
                item.id % 2 === 0
                  ? FadeIn({ durationMs: 300 })
                  : SlideInRight({ durationMs: 300 }),
              ),
              h.Exiting(FadeOut({ durationMs: 250 })),
              h.Style({
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: 16,
                borderRadius: 12,
                backgroundColor: '#e7eee7',
              }),
            ],
            [
              h.p([], [`Item ${item.id + 1}`]),
              h.button(
                [
                  h.OnClick(Message.ClickedRemoveItem({ id: item.id })),
                  h.AriaLabel(`Remove item ${item.id + 1}`),
                  h.Style({ color: '#8c4430', padding: 8 }),
                ],
                ['Remove'],
              ),
            ],
          ),
        ),
      ),
      h.h2(
        [h.Style({ fontSize: 20, fontWeight: 'bold' })],
        ['UI thread motion'],
      ),
      h.p(
        [],
        ['Drag a little to spring back. Drag farther or fling to fly out.'],
      ),
      h.div(
        [h.Style({ overflow: 'hidden' })],
        [
          h.div(
            [
              h.Style(CARD_STYLE),
              h.AnimatedStyle(cardOffset, cardStyle),
              h.Gesture(
                Pan({
                  trackX: cardOffset,
                  onEnd: event => Message.EndedCardPan({ event }),
                }),
              ),
            ],
            [
              h.p(
                [h.Style({ fontSize: 22, fontWeight: 'bold' })],
                ['Drag this card'],
              ),
              h.p([], ['Animated values stay outside the Model.']),
            ],
          ),
        ],
      ),
      h.p([], [`Flew out ${model.flyOuts} · Sprang back ${model.springBacks}`]),
      h.h2(
        [h.Style({ fontSize: 20, fontWeight: 'bold' })],
        ['Background worklet'],
      ),
      h.button(
        [
          h.OnClick(Message.ClickedCountPrimes()),
          h.Disabled(isCounting),
          h.Style({ ...BUTTON_STYLE, opacity: isCounting ? 0.5 : 1 }),
        ],
        ['Count primes'],
      ),
      primeStatus,
    ],
  )
}
