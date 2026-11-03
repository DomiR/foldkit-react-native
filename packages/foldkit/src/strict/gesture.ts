import { Predicate, Schema } from 'effect'

import { defineTaggedUnion } from '../schema/index.js'
import { AnimatedValueKey } from './animation.js'

/** Translation in density-independent pixels and velocity in pixels per second.
 * @experimental The strict gesture contract may change between releases. */
export const PanEnd = Schema.Struct({
  translationX: Schema.Number,
  translationY: Schema.Number,
  velocityX: Schema.Number,
  velocityY: Schema.Number,
})

/** The final translation and velocity of a recognized pan. @experimental */
export type PanEnd = typeof PanEnd.Type

/** Directions supported by a strict swipe. @experimental */
export const SwipeDirection = Schema.Literals(['Left', 'Right', 'Up', 'Down'])

/** A strict swipe direction. @experimental */
export type SwipeDirection = typeof SwipeDirection.Type

const makeGestureSchema = <Message>(
  Message: Schema.Codec<Message, any, unknown, unknown>,
) =>
  defineTaggedUnion({
    Tap: { numberOfTaps: Schema.optionalKey(Schema.Number), onTap: Message },
    LongPress: {
      minDurationMs: Schema.optionalKey(Schema.Number),
      onLongPress: Message,
    },
    Pan: {
      minDistance: Schema.optionalKey(Schema.Number),
      trackX: Schema.optionalKey(AnimatedValueKey),
      trackY: Schema.optionalKey(AnimatedValueKey),
      onEnd: Schema.declare<(event: PanEnd) => Message>(
        (input): input is (event: PanEnd) => Message =>
          Predicate.isFunction(input),
      ),
    },
    Swipe: { direction: SwipeDirection, onSwipe: Message },
  })

/** Plain gesture descriptions consumed by strict host adapters. @experimental */
export type StrictGesture<Message> = ReturnType<
  typeof makeGestureSchema<Message>
>['Type']

const GestureData = makeGestureSchema(Schema.Unknown)

/** Schema construction and exhaustive matching for strict gesture descriptions.
 * @experimental The strict gesture contract may change between releases. */
export const StrictGesture = {
  Schema: makeGestureSchema,
  match: GestureData.match,
}

/** Declares a tap within 10 points of its start that records a Message after the requested tap count. @experimental */
export const Tap = <Message>(
  payload: Readonly<{ numberOfTaps?: number; onTap: Message }>,
): StrictGesture<Message> => ({ _tag: 'Tap', ...payload })

/** Declares a long press that records a Message after its minimum duration, before release.
 * Movement beyond 10 points before activation cancels recognition. A recognized long press suppresses Tap.
 * @experimental */
export const LongPress = <Message>(
  payload: Readonly<{ minDurationMs?: number; onLongPress: Message }>,
): StrictGesture<Message> => ({ _tag: 'LongPress', ...payload })

/** Declares a pan whose final position and velocity become a Message. @experimental */
export const Pan = <Message>(
  payload: Readonly<{
    minDistance?: number
    trackX?: AnimatedValueKey
    trackY?: AnimatedValueKey
    onEnd: (event: PanEnd) => Message
  }>,
): StrictGesture<Message> => ({ _tag: 'Pan', ...payload })

/** Declares a directional swipe that records a Message after at least 50 points of travel
 * with a release velocity of at least 500 points per second in that direction. @experimental */
export const Swipe = <Message>(
  payload: Readonly<{ direction: SwipeDirection; onSwipe: Message }>,
): StrictGesture<Message> => ({ _tag: 'Swipe', ...payload })
