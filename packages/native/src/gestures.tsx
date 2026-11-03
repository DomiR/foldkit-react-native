import { Array, Option, Schema } from 'effect'
import { PanEnd, StrictGesture } from 'foldkit/strict'
import * as React from 'react'
import {
  GestureDetector,
  useCompetingGestures,
  useExclusiveGestures,
  useLongPressGesture,
  usePanGesture,
  useSimultaneousGestures,
  useTapGesture,
  type PanGestureConfig,
} from 'react-native-gesture-handler'
import { cancelAnimation } from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'

import { useNativeAnimationHost } from './animationContext'

const DEFAULT_TAP_COUNT = 1
const DEFAULT_LONG_PRESS_MS = 500
const DEFAULT_PAN_DISTANCE = 10
const MAX_STILL_DISTANCE = 10
const MAX_CROSS_AXIS_DISTANCE = 15
const MIN_SWIPE_DISTANCE = 50
const MIN_SWIPE_VELOCITY = 500

const SwipeStart = Schema.Struct({
  absoluteX: Schema.Number,
  absoluteY: Schema.Number,
})
type SwipeStart = typeof SwipeStart.Type

const PanRecognition = Schema.Struct({
  axis: Schema.Literals(['Horizontal', 'Vertical', 'Free']),
  distance: Schema.Number,
})
type PanRecognition = typeof PanRecognition.Type
type PanGestureCallbacks = Pick<
  PanGestureConfig,
  | 'runOnJS'
  | 'disableReanimated'
  | 'onBegin'
  | 'onActivate'
  | 'onUpdate'
  | 'onDeactivate'
  | 'onFinalize'
>
type PanRecognizerProps = Readonly<{
  distance: number
  callbacks: PanGestureCallbacks
  children: (gesture: NativeGesture) => React.ReactElement
}>

type NativeGesture = Parameters<typeof useSimultaneousGestures>[number]
type RegisteredGesture = Readonly<{
  kind: StrictGesture<unknown>['_tag']
  gesture: NativeGesture
}>
type GestureCase<Message, Tag extends StrictGesture<Message>['_tag']> = Extract<
  StrictGesture<Message>,
  Readonly<{ _tag: Tag }>
>
type BridgeProps<
  Message,
  Tag extends StrictGesture<Message>['_tag'],
> = Readonly<{
  definition: GestureCase<Message, Tag>
  dispatch: (message: Message) => void
  children: (gesture: NativeGesture) => React.ReactElement
}>
type PanBridgeProps<Message> = BridgeProps<Message, 'Pan'> &
  Readonly<{ recognition: PanRecognition }>

const HorizontalPanRecognizer = ({
  distance,
  callbacks,
  children,
}: PanRecognizerProps): React.ReactElement => {
  const gesture = usePanGesture({
    activeOffsetX: [-distance, distance],
    failOffsetY: [-MAX_CROSS_AXIS_DISTANCE, MAX_CROSS_AXIS_DISTANCE],
    runOnJS: callbacks.runOnJS,
    disableReanimated: callbacks.disableReanimated,
    onBegin: callbacks.onBegin,
    onActivate: callbacks.onActivate,
    onUpdate: callbacks.onUpdate,
    onDeactivate: callbacks.onDeactivate,
    onFinalize: callbacks.onFinalize,
  })
  return children(gesture)
}

const VerticalPanRecognizer = ({
  distance,
  callbacks,
  children,
}: PanRecognizerProps): React.ReactElement => {
  const gesture = usePanGesture({
    activeOffsetY: [-distance, distance],
    failOffsetX: [-MAX_CROSS_AXIS_DISTANCE, MAX_CROSS_AXIS_DISTANCE],
    runOnJS: callbacks.runOnJS,
    disableReanimated: callbacks.disableReanimated,
    onBegin: callbacks.onBegin,
    onActivate: callbacks.onActivate,
    onUpdate: callbacks.onUpdate,
    onDeactivate: callbacks.onDeactivate,
    onFinalize: callbacks.onFinalize,
  })
  return children(gesture)
}

const FreePanRecognizer = ({
  distance,
  callbacks,
  children,
}: PanRecognizerProps): React.ReactElement => {
  const gesture = usePanGesture({
    minDistance: distance,
    runOnJS: callbacks.runOnJS,
    disableReanimated: callbacks.disableReanimated,
    onBegin: callbacks.onBegin,
    onActivate: callbacks.onActivate,
    onUpdate: callbacks.onUpdate,
    onDeactivate: callbacks.onDeactivate,
    onFinalize: callbacks.onFinalize,
  })
  return children(gesture)
}

const PanRecognizer = ({
  recognition,
  callbacks,
  children,
}: Readonly<{
  recognition: PanRecognition
  callbacks: PanGestureCallbacks
  children: (gesture: NativeGesture) => React.ReactElement
}>): React.ReactElement => {
  if (recognition.axis === 'Horizontal') {
    return (
      <HorizontalPanRecognizer
        distance={recognition.distance}
        callbacks={callbacks}
      >
        {children}
      </HorizontalPanRecognizer>
    )
  } else if (recognition.axis === 'Vertical') {
    return (
      <VerticalPanRecognizer
        distance={recognition.distance}
        callbacks={callbacks}
      >
        {children}
      </VerticalPanRecognizer>
    )
  } else {
    return (
      <FreePanRecognizer distance={recognition.distance} callbacks={callbacks}>
        {children}
      </FreePanRecognizer>
    )
  }
}

const TapBridge = <Message,>({
  definition,
  dispatch,
  children,
}: BridgeProps<Message, 'Tap'>): React.ReactElement => {
  const gesture = useTapGesture({
    numberOfTaps: definition.numberOfTaps ?? DEFAULT_TAP_COUNT,
    maxDistance: MAX_STILL_DISTANCE,
    runOnJS: true,
    disableReanimated: true,
    onActivate: () => {
      dispatch(definition.onTap)
    },
  })
  return children(gesture)
}

const LongPressBridge = <Message,>({
  definition,
  dispatch,
  children,
}: BridgeProps<Message, 'LongPress'>): React.ReactElement => {
  const gesture = useLongPressGesture({
    minDuration: definition.minDurationMs ?? DEFAULT_LONG_PRESS_MS,
    maxDistance: MAX_STILL_DISTANCE,
    shouldCancelWhenOutside: false,
    runOnJS: true,
    disableReanimated: true,
    onActivate: () => {
      dispatch(definition.onLongPress)
    },
  })
  return children(gesture)
}

const panRecognition = <Message,>(
  definition: GestureCase<Message, 'Pan'>,
  definitions: ReadonlyArray<StrictGesture<Message>>,
): PanRecognition => {
  const distance = definition.minDistance ?? DEFAULT_PAN_DISTANCE
  const isTracking =
    definition.trackX !== undefined || definition.trackY !== undefined
  const isHorizontal = isTracking
    ? definition.trackX !== undefined
    : definitions.some(
        gesture =>
          gesture._tag === 'Swipe' &&
          (gesture.direction === 'Left' || gesture.direction === 'Right'),
      )
  const isVertical = isTracking
    ? definition.trackY !== undefined
    : definitions.some(
        gesture =>
          gesture._tag === 'Swipe' &&
          (gesture.direction === 'Up' || gesture.direction === 'Down'),
      )

  if (isHorizontal && !isVertical) {
    return PanRecognition.make({ axis: 'Horizontal', distance })
  } else if (isVertical && !isHorizontal) {
    return PanRecognition.make({ axis: 'Vertical', distance })
  } else {
    return PanRecognition.make({ axis: 'Free', distance })
  }
}

const PanBridge = <Message,>({
  definition,
  recognition,
  dispatch,
  children,
}: PanBridgeProps<Message>): React.ReactElement => {
  const callbacks: PanGestureCallbacks = {
    runOnJS: true,
    disableReanimated: true,
    onDeactivate: event => {
      if (!event.canceled) {
        dispatch(
          definition.onEnd(
            PanEnd.make({
              translationX: event.translationX,
              translationY: event.translationY,
              velocityX: event.velocityX,
              velocityY: event.velocityY,
            }),
          ),
        )
      }
    },
  }
  return (
    <PanRecognizer recognition={recognition} callbacks={callbacks}>
      {children}
    </PanRecognizer>
  )
}

const TrackedPanBridge = <Message,>({
  definition,
  recognition,
  dispatch,
  children,
}: PanBridgeProps<Message>): React.ReactElement => {
  const host = useNativeAnimationHost()
  const horizontal =
    definition.trackX === undefined
      ? undefined
      : host.mutable(definition.trackX)
  const vertical =
    definition.trackY === undefined
      ? undefined
      : host.mutable(definition.trackY)
  const initialX = definition.trackX?.initial ?? 0
  const initialY = definition.trackY?.initial ?? 0
  const finishOnRN = (
    translationX: number,
    translationY: number,
    velocityX: number,
    velocityY: number,
  ): void => {
    dispatch(
      definition.onEnd(
        PanEnd.make({ translationX, translationY, velocityX, velocityY }),
      ),
    )
  }
  const callbacks: PanGestureCallbacks = {
    runOnJS: false,
    disableReanimated: false,
    onActivate: () => {
      'worklet'
      if (horizontal !== undefined) {
        cancelAnimation(horizontal)
        horizontal.value = 0
      }
      if (vertical !== undefined) {
        cancelAnimation(vertical)
        vertical.value = 0
      }
    },
    onUpdate: event => {
      'worklet'
      if (horizontal !== undefined) {
        horizontal.value = event.translationX
      }
      if (vertical !== undefined) {
        vertical.value = event.translationY
      }
    },
    onDeactivate: event => {
      'worklet'
      if (event.canceled) {
        if (horizontal !== undefined) {
          horizontal.value = initialX
        }
        if (vertical !== undefined) {
          vertical.value = initialY
        }
      } else {
        scheduleOnRN(
          finishOnRN,
          event.translationX,
          event.translationY,
          event.velocityX,
          event.velocityY,
        )
      }
    },
  }
  return (
    <PanRecognizer recognition={recognition} callbacks={callbacks}>
      {children}
    </PanRecognizer>
  )
}

const SwipeBridge = <Message,>({
  definition,
  dispatch,
  children,
}: BridgeProps<Message, 'Swipe'>): React.ReactElement => {
  const maybeStart = React.useRef<Option.Option<SwipeStart>>(Option.none())
  const isHorizontal =
    definition.direction === 'Left' || definition.direction === 'Right'
  const isPositive =
    definition.direction === 'Right' || definition.direction === 'Down'
  const recognition = PanRecognition.make({
    axis: isHorizontal ? 'Horizontal' : 'Vertical',
    distance: MAX_STILL_DISTANCE,
  })
  const callbacks: PanGestureCallbacks = {
    runOnJS: true,
    disableReanimated: true,
    onBegin: event => {
      maybeStart.current = Option.some(
        SwipeStart.make({
          absoluteX: event.absoluteX,
          absoluteY: event.absoluteY,
        }),
      )
    },
    onDeactivate: event => {
      if (event.canceled || Option.isNone(maybeStart.current)) {
        return
      }

      const start = maybeStart.current.value
      const translationX = event.absoluteX - start.absoluteX
      const translationY = event.absoluteY - start.absoluteY
      const translation = isHorizontal ? translationX : translationY
      const axisVelocity = isHorizontal ? event.velocityX : event.velocityY
      const distance = isPositive ? translation : -translation
      const velocity = isPositive ? axisVelocity : -axisVelocity
      const crossAxisDistance = Math.abs(
        isHorizontal ? translationY : translationX,
      )
      const isDominantAxis = isHorizontal
        ? distance >= crossAxisDistance
        : distance > crossAxisDistance

      if (
        distance >= MIN_SWIPE_DISTANCE &&
        velocity >= MIN_SWIPE_VELOCITY &&
        isDominantAxis
      ) {
        dispatch(definition.onSwipe)
      }
    },
    onFinalize: () => {
      maybeStart.current = Option.none()
    },
  }
  return (
    <PanRecognizer recognition={recognition} callbacks={callbacks}>
      {children}
    </PanRecognizer>
  )
}

const ComposedGestures = ({
  gestures,
  children,
}: Readonly<{
  gestures: ReadonlyArray<RegisteredGesture>
  children: React.ReactElement
}>): React.ReactElement => {
  const moving = useSimultaneousGestures(
    ...gestures
      .filter(entry => entry.kind === 'Pan' || entry.kind === 'Swipe')
      .map(entry => entry.gesture),
  )
  const holding = useSimultaneousGestures(
    ...gestures
      .filter(entry => entry.kind === 'LongPress')
      .map(entry => entry.gesture),
  )
  const tapping = useSimultaneousGestures(
    ...gestures
      .filter(entry => entry.kind === 'Tap')
      .map(entry => entry.gesture),
  )
  const movingOrTapping = useCompetingGestures(moving, tapping)
  const gesture = useExclusiveGestures(holding, movingOrTapping)
  return <GestureDetector gesture={gesture}>{children}</GestureDetector>
}

const GestureChain = <Message,>({
  definitions,
  recognizePan,
  gestures,
  dispatch,
  children,
}: Readonly<{
  definitions: ReadonlyArray<StrictGesture<Message>>
  recognizePan: (definition: GestureCase<Message, 'Pan'>) => PanRecognition
  gestures: ReadonlyArray<RegisteredGesture>
  dispatch: (message: Message) => void
  children: React.ReactElement
}>): React.ReactElement =>
  Array.matchLeft(definitions, {
    onEmpty: () => (
      <ComposedGestures gestures={gestures}>{children}</ComposedGestures>
    ),
    onNonEmpty: (definition, remaining) => {
      const appendGesture = (gesture: NativeGesture) => (
        <GestureChain
          definitions={remaining}
          recognizePan={recognizePan}
          gestures={[...gestures, { kind: definition._tag, gesture }]}
          dispatch={dispatch}
        >
          {children}
        </GestureChain>
      )
      return StrictGesture.match<React.ReactElement, StrictGesture<Message>>(
        definition,
        {
          Tap: definition => (
            <TapBridge definition={definition} dispatch={dispatch}>
              {appendGesture}
            </TapBridge>
          ),
          LongPress: definition => (
            <LongPressBridge definition={definition} dispatch={dispatch}>
              {appendGesture}
            </LongPressBridge>
          ),
          Pan: definition => {
            if (
              definition.trackX !== undefined ||
              definition.trackY !== undefined
            ) {
              return (
                <TrackedPanBridge
                  definition={definition}
                  recognition={recognizePan(definition)}
                  dispatch={dispatch}
                >
                  {appendGesture}
                </TrackedPanBridge>
              )
            } else {
              return (
                <PanBridge
                  definition={definition}
                  recognition={recognizePan(definition)}
                  dispatch={dispatch}
                >
                  {appendGesture}
                </PanBridge>
              )
            }
          },
          Swipe: definition => (
            <SwipeBridge definition={definition} dispatch={dispatch}>
              {appendGesture}
            </SwipeBridge>
          ),
        },
      )
    },
  })

/** Gives LongPress priority over movement and Tap while Pan and Swipe recognize together. */
export const NativeGestures = <Message,>({
  gestures,
  dispatch,
  children,
}: Readonly<{
  gestures: ReadonlyArray<StrictGesture<Message>>
  dispatch: (message: Message) => void
  children: React.ReactElement
}>): React.ReactElement => (
  <GestureChain
    definitions={gestures}
    recognizePan={definition => panRecognition(definition, gestures)}
    gestures={[]}
    dispatch={dispatch}
  >
    {children}
  </GestureChain>
)
