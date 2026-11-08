import { Array, Option } from 'effect'
import { LongPress, Pan, type StrictView, Swipe, Tap } from 'foldkit/strict'

import { strictView as animationsView } from './animations/strictView'
import { strictView as chatView } from './chat/strictView'
import { strictView as contactsView } from './contacts/strictView'
import { strictView as counterView } from './counter/strictView'
import { strictView as formView } from './form/strictView'
import {
  AnimationsBinding,
  ChatBinding,
  ContactsBinding,
  CounterBinding,
  Example,
  FormBinding,
  Message,
  type Model,
  ShowcaseRoute,
  StopwatchBinding,
  TodoBinding,
} from './showcase'
import { strictView as stopwatchView } from './stopwatch/strictView'
import { strictView as todoView } from './todo/strictView'

export const showcaseStrictView: StrictView<Model, Message> = (model, h) => {
  const homeView = () =>
    h.div(
      [h.Style({ padding: 24, gap: 16 })],
      [
        h.h1(
          [h.Style({ fontSize: 28, fontWeight: 'bold', color: '#182c25' })],
          ['Shared examples'],
        ),
        h.p(
          [h.Style({ color: '#627a6c', fontSize: 16 })],
          ['Choose an example. Its view and program run on both hosts.'],
        ),
        ...Array.map(Example.literals, example =>
          h.keyed('button')(
            example,
            [
              h.OnClick(Message.PressedExampleRow({ example })),
              h.Style({
                flexDirection: 'row',
                justifyContent: 'space-between',
                padding: 20,
                backgroundColor: '#e7eee7',
                borderRadius: 12,
                color: '#182c25',
                fontSize: 18,
              }),
            ],
            [example, h.span([], ['›'])],
          ),
        ),
      ],
    )
  const routeView = (route: ShowcaseRoute) =>
    ShowcaseRoute.match(route, {
      Home: homeView,
      Counter: () => h.block(CounterBinding, model.counter, counterView),
      Stopwatch: () =>
        h.block(StopwatchBinding, model.stopwatch, stopwatchView),
      Todo: () => h.block(TodoBinding, model.todo, todoView),
      Form: () => h.block(FormBinding, model.form, formView),
      Contacts: () => h.block(ContactsBinding, model.contacts, contactsView),
      Chat: () => h.block(ChatBinding, model.chat, chatView),
    })
  const titleForRoute = (route: ShowcaseRoute): string =>
    ShowcaseRoute.match(route, {
      Home: () => 'Examples',
      Counter: () => 'Counter',
      Stopwatch: () => 'Stopwatch',
      Todo: () => 'Todo',
      Form: () => 'Form',
      Contacts: () => 'Contacts',
      Chat: () => 'Chat',
    })
  const gesturesView = () =>
    h.div(
      [h.Style({ flex: 1, padding: 24, gap: 20 })],
      [
        h.h1(
          [h.Style({ fontSize: 28, fontWeight: 'bold', color: '#182c25' })],
          ['Gestures'],
        ),
        h.p(
          [h.Style({ color: '#627a6c', fontSize: 16 })],
          [
            'Tap to count. Hold to reset. Swipe right to like or left to dislike. Drag to inspect the pan.',
          ],
        ),
        h.div(
          [
            h.AriaLabel('Gesture card'),
            h.Style({
              minHeight: 220,
              padding: 24,
              borderRadius: 20,
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
              backgroundColor: '#182c25',
              color: '#ffffff',
            }),
            h.Gesture(Tap({ onTap: Message.TappedCard() })),
            h.Gesture(
              LongPress({
                minDurationMs: 500,
                onLongPress: Message.LongPressedCard(),
              }),
            ),
            h.Gesture(
              Swipe({
                direction: 'Right',
                onSwipe: Message.SwipedCard({ direction: 'Right' }),
              }),
            ),
            h.Gesture(
              Swipe({
                direction: 'Left',
                onSwipe: Message.SwipedCard({ direction: 'Left' }),
              }),
            ),
            h.Gesture(
              Pan({
                minDistance: 10,
                onEnd: event => Message.EndedCardPan({ event }),
              }),
            ),
          ],
          [
            h.p(
              [h.Style({ fontSize: 40, fontWeight: 'bold' })],
              [model.taps.toString()],
            ),
            h.p([h.Style({ fontSize: 16 })], ['Tap / hold / swipe / pan']),
          ],
        ),
        h.p(
          [h.Style({ color: '#182c25', fontSize: 18 })],
          [`Likes ${model.likes} · Dislikes ${model.dislikes}`],
        ),
        Option.match(model.maybeLastPan, {
          onNone: () =>
            h.p([h.Style({ color: '#627a6c' })], ['No completed pan']),
          onSome: event =>
            h.div(
              [h.Style({ gap: 8 })],
              [
                h.p(
                  [h.Style({ color: '#182c25' })],
                  [
                    `Translation: ${event.translationX.toFixed(1)}, ${event.translationY.toFixed(1)}`,
                  ],
                ),
                h.p(
                  [h.Style({ color: '#627a6c' })],
                  [
                    `Velocity: ${event.velocityX.toFixed(1)}, ${event.velocityY.toFixed(1)} px/s`,
                  ],
                ),
              ],
            ),
        }),
      ],
    )

  return h.tabs(
    [
      h.SelectedTab(model.tabs),
      h.OnSelectTab(key => Message.SelectedTab({ key })),
      h.Style({
        flex: 1,
        width: '100%',
        backgroundColor: '#f1f4ef',
      }),
    ],
    [
      h.tab(
        'Examples',
        [
          h.Title('Examples'),
          h.TabIcon({
            sfSymbol: 'square.grid.2x2',
            selectedSfSymbol: 'square.grid.2x2.fill',
            materialSymbol: 'grid-view',
            webGlyph: '▦',
          }),
        ],
        [
          h.stack(
            [
              h.OnDismissed(dismissedCount =>
                Message.DismissedScreens({ dismissedCount }),
              ),
              h.Style({ flex: 1 }),
            ],
            Array.map(model.stack, route =>
              h.screen(
                route.id.toString(),
                [h.Title(titleForRoute(route))],
                [routeView(route)],
              ),
            ),
          ),
        ],
      ),
      h.tab(
        'Gestures',
        [
          h.Title('Gestures'),
          h.TabIcon({
            sfSymbol: 'hand.tap',
            selectedSfSymbol: 'hand.tap.fill',
            materialSymbol: 'touch-app',
            webGlyph: '☝',
          }),
        ],
        [gesturesView()],
      ),
      h.tab(
        'Animations',
        [
          h.Title('Animations'),
          h.TabIcon({
            sfSymbol: 'sparkles',
            materialSymbol: 'auto-awesome',
            webGlyph: '✦',
          }),
        ],
        [
          h.stack(
            [h.Style({ flex: 1 })],
            [
              h.screen(
                'Animations',
                [h.Title('Animations')],
                [h.block(AnimationsBinding, model.animations, animationsView)],
              ),
            ],
          ),
        ],
      ),
    ],
  )
}
