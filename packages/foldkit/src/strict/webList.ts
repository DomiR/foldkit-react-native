import { Array, Effect, Predicate, Queue, Schema, Stream } from 'effect'

import {
  type Attribute,
  type Html,
  type HtmlBuilder,
  Prop,
} from '../html/index.js'
import type { StrictHtmlBuilder, StrictList } from './strict.js'

const END_REACHED_PROPERTY = '__foldkitStrictListEndReached'
const END_REACHED_ROOT_MARGIN = '0px 0px 50% 0px'
const END_SENTINEL_KEY_PREFIX = 'foldkit/strict/listEnd/'

const listStyle: Record<string, string> = {
  'overflow-y': 'auto',
  'min-height': '0px',
  flex: '1 1 0%',
}

const sentinelStyle: Record<string, string> = {
  height: '1px',
  'flex-shrink': '0',
}

const renderEndSentinel = <Message>(
  h: HtmlBuilder<Message>,
  itemCount: number,
  message: Message,
): Html => {
  const ReadMessage = Schema.declare<() => Message>(
    (input): input is () => Message => Predicate.isFunction(input),
  )
  const decodeReadMessage = Schema.decodeUnknownSync(ReadMessage)

  return h.keyed('div')(`${END_SENTINEL_KEY_PREFIX}${itemCount}`, [
    h.Style(sentinelStyle),
    h.AriaHidden(true),
    Prop({ key: END_REACHED_PROPERTY, value: () => message }),
    h.OnMount({
      name: 'ObserveStrictListEnd',
      f: element =>
        Stream.callback<Message>(queue =>
          Effect.gen(function* () {
            if (!(element instanceof HTMLElement)) {
              return yield* Effect.never
            }

            const readCurrent = () =>
              decodeReadMessage(Reflect.get(element, END_REACHED_PROPERTY))()

            yield* Effect.acquireRelease(
              Effect.sync(() => {
                const observer = new IntersectionObserver(
                  entries => {
                    for (const entry of entries) {
                      if (entry.isIntersecting) {
                        Queue.offerUnsafe(queue, readCurrent())
                      }
                    }
                  },
                  {
                    root: element.parentElement,
                    rootMargin: END_REACHED_ROOT_MARGIN,
                  },
                )

                observer.observe(element)

                return observer
              }),
              observer => Effect.sync(() => observer.disconnect()),
            )

            return yield* Effect.never
          }),
        ),
    }),
  ])
}

/** Renders keyed rows in a scroll container with an optional end observer.
 * Row height enables the browser to skip layout of off-screen content.
 * @internal */
export const renderStrictList = <Item, Message>(
  h: HtmlBuilder<Message>,
  builder: StrictHtmlBuilder<Message, Html, Attribute<Message>>,
  attributes: ReadonlyArray<Attribute<Message>>,
  { items, key, view, itemHeight }: StrictList<Item, Html>,
  onEndReached: Message | undefined,
): Html => {
  const rowStyle: Record<string, string> =
    itemHeight === undefined
      ? {}
      : {
          'content-visibility': 'auto',
          'contain-intrinsic-size': `auto ${itemHeight}px`,
        }
  const rows = Array.map(items, (item, index) =>
    builder.keyed('div')(
      key(item),
      [h.Role('listitem'), h.Style(rowStyle)],
      [view(item, index)],
    ),
  )
  const children =
    onEndReached === undefined
      ? rows
      : [...rows, renderEndSentinel(h, items.length, onEndReached)]

  return builder.div(
    [h.Role('list'), h.Style(listStyle), ...attributes],
    children,
  )
}
