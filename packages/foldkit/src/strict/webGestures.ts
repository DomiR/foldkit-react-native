import { Array, Function, Option, Schema } from 'effect'

import { PanEnd, StrictGesture, type SwipeDirection } from './gesture.js'
import type { WebAnimationHost } from './webAnimation.js'

const GESTURE_ATTRIBUTE = 'data-foldkit-strict-gesture'
const MAX_TAP_DISTANCE = 10
const MAX_TAP_DURATION_MS = 500
const DEFAULT_LONG_PRESS_MS = 500
const DEFAULT_PAN_DISTANCE = 10
const MIN_SWIPE_DISTANCE = 50
const MIN_SWIPE_VELOCITY = 500
const MILLIS_PER_SECOND = 1000
const VELOCITY_IDLE_MS = 100

const PointerTrack = Schema.Struct({
  startX: Schema.Number,
  startY: Schema.Number,
  startTime: Schema.Number,
  lastX: Schema.Number,
  lastY: Schema.Number,
  lastTime: Schema.Number,
  lastMovementTime: Schema.Number,
  distance: Schema.Number,
  velocityX: Schema.Number,
  velocityY: Schema.Number,
  pressState: Schema.Literals(['Pending', 'Canceled', 'Activated']),
})
type PointerTrack = typeof PointerTrack.Type

const movePointer = (
  track: PointerTrack,
  event: PointerEvent,
): PointerTrack => {
  const elapsedMs = Math.max(1, event.timeStamp - track.lastTime)
  const isMoved = event.clientX !== track.lastX || event.clientY !== track.lastY
  const isVelocityExpired =
    event.timeStamp - track.lastMovementTime > VELOCITY_IDLE_MS
  const velocityX = isMoved
    ? ((event.clientX - track.lastX) * MILLIS_PER_SECOND) / elapsedMs
    : track.velocityX
  const velocityY = isMoved
    ? ((event.clientY - track.lastY) * MILLIS_PER_SECOND) / elapsedMs
    : track.velocityY
  const distance = Math.max(
    track.distance,
    Math.hypot(event.clientX - track.startX, event.clientY - track.startY),
  )

  return {
    ...track,
    lastX: event.clientX,
    lastY: event.clientY,
    lastTime: event.timeStamp,
    lastMovementTime: isMoved ? event.timeStamp : track.lastMovementTime,
    distance,
    velocityX: isVelocityExpired && !isMoved ? 0 : velocityX,
    velocityY: isVelocityExpired && !isMoved ? 0 : velocityY,
    pressState:
      track.pressState === 'Pending' && distance > MAX_TAP_DISTANCE
        ? 'Canceled'
        : track.pressState,
  }
}

const swipeDirection = (event: PanEnd): Option.Option<SwipeDirection> => {
  const isHorizontal =
    Math.abs(event.translationX) >= Math.abs(event.translationY)
  const distance = isHorizontal ? event.translationX : event.translationY
  const velocity = isHorizontal ? event.velocityX : event.velocityY

  if (
    Math.abs(distance) < MIN_SWIPE_DISTANCE ||
    Math.abs(velocity) < MIN_SWIPE_VELOCITY ||
    Math.sign(distance) !== Math.sign(velocity)
  ) {
    return Option.none()
  }

  if (isHorizontal) {
    return Option.some(distance < 0 ? 'Left' : 'Right')
  } else {
    return Option.some(distance < 0 ? 'Up' : 'Down')
  }
}

/** Acquires gesture listeners with state scoped to one mounted element. @internal */
export const listenForGestures = <Message>(
  element: HTMLElement,
  readGestures: () => ReadonlyArray<StrictGesture<Message>>,
  emit: (message: Message) => void,
  animationHost: WebAnimationHost | undefined,
): (() => void) => {
  const pointers = new Map<number, PointerTrack>()
  const longPressTimers = new Map<
    number,
    ReadonlyArray<ReturnType<typeof setTimeout>>
  >()
  let isClickSuppressed = false

  const isGestureTarget = (event: Event): boolean =>
    event.target instanceof Element &&
    event.target.closest(`[${GESTURE_ATTRIBUTE}]`) === element

  const releaseCapture = (pointerId: number): void => {
    if (element.hasPointerCapture(pointerId)) {
      element.releasePointerCapture(pointerId)
    }
  }

  const clearLongPressTimers = (pointerId: number): void => {
    for (const timer of longPressTimers.get(pointerId) ?? []) {
      clearTimeout(timer)
    }
    longPressTimers.delete(pointerId)
  }

  const cancelPressForPan = (track: PointerTrack): PointerTrack => {
    const gestures = readGestures()
    const isWaitingForLongPress = gestures.some(
      gesture => gesture._tag === 'LongPress',
    )

    if (
      track.pressState === 'Pending' &&
      !isWaitingForLongPress &&
      gestures.some(
        gesture =>
          gesture._tag === 'Pan' &&
          track.distance >= (gesture.minDistance ?? DEFAULT_PAN_DISTANCE),
      )
    ) {
      return { ...track, pressState: 'Canceled' }
    } else {
      return track
    }
  }

  const scheduleLongPresses = (pointerId: number): void => {
    const durations = new Set<number>()
    for (const gesture of readGestures()) {
      if (gesture._tag === 'LongPress') {
        durations.add(gesture.minDurationMs ?? DEFAULT_LONG_PRESS_MS)
      }
    }

    const timers = Array.fromIterable(durations).map(durationMs =>
      setTimeout(() => {
        const track = pointers.get(pointerId)
        if (
          track === undefined ||
          track.pressState === 'Canceled' ||
          track.distance > MAX_TAP_DISTANCE
        ) {
          return
        }

        const gestures = readGestures().filter(
          gesture =>
            gesture._tag === 'LongPress' &&
            (gesture.minDurationMs ?? DEFAULT_LONG_PRESS_MS) === durationMs,
        )
        if (Array.isReadonlyArrayEmpty(gestures)) {
          return
        }

        pointers.set(pointerId, { ...track, pressState: 'Activated' })
        isClickSuppressed = true
        for (const gesture of gestures) {
          if (gesture._tag === 'LongPress') {
            emit(gesture.onLongPress)
          }
        }
      }, durationMs),
    )
    longPressTimers.set(pointerId, timers)
  }

  const pointerDown = (event: PointerEvent): void => {
    if (
      event.button !== 0 ||
      !isGestureTarget(event) ||
      Array.isReadonlyArrayEmpty(readGestures())
    ) {
      return
    }

    pointers.set(event.pointerId, {
      startX: event.clientX,
      startY: event.clientY,
      startTime: event.timeStamp,
      lastX: event.clientX,
      lastY: event.clientY,
      lastTime: event.timeStamp,
      lastMovementTime: event.timeStamp,
      distance: 0,
      velocityX: 0,
      velocityY: 0,
      pressState: 'Pending',
    })
    isClickSuppressed = false
    element.setPointerCapture(event.pointerId)
    scheduleLongPresses(event.pointerId)
  }

  const trackPanValues = (
    track: PointerTrack,
    event: PointerEvent,
    isCanceled: boolean,
  ): void => {
    const gestures = readGestures()
    const isWaitingForLongPress =
      track.pressState === 'Pending' &&
      gestures.some(gesture => gesture._tag === 'LongPress')

    if (animationHost === undefined || isWaitingForLongPress) {
      return
    }
    for (const gesture of gestures) {
      if (
        gesture._tag === 'Pan' &&
        track.pressState !== 'Activated' &&
        track.distance >= (gesture.minDistance ?? DEFAULT_PAN_DISTANCE)
      ) {
        if (gesture.trackX !== undefined) {
          animationHost.write(
            gesture.trackX,
            isCanceled ? gesture.trackX.initial : event.clientX - track.startX,
          )
        }
        if (gesture.trackY !== undefined) {
          animationHost.write(
            gesture.trackY,
            isCanceled ? gesture.trackY.initial : event.clientY - track.startY,
          )
        }
      }
    }
  }

  const pointerMove = (event: PointerEvent): void => {
    const track = pointers.get(event.pointerId)
    if (track !== undefined) {
      const movedTrack = cancelPressForPan(movePointer(track, event))
      pointers.set(event.pointerId, movedTrack)
      if (
        movedTrack.pressState === 'Canceled' ||
        movedTrack.distance > MAX_TAP_DISTANCE
      ) {
        clearLongPressTimers(event.pointerId)
      }
      trackPanValues(movedTrack, event, false)
    }
  }

  const pointerCancel = (event: PointerEvent): void => {
    const track = pointers.get(event.pointerId)
    if (track === undefined) {
      return
    }

    trackPanValues(track, event, true)
    clearLongPressTimers(event.pointerId)
    pointers.delete(event.pointerId)
    isClickSuppressed = true
    releaseCapture(event.pointerId)
  }

  const pointerUp = (event: PointerEvent): void => {
    const track = pointers.get(event.pointerId)
    if (track === undefined) {
      return
    }

    const endedTrack = cancelPressForPan(movePointer(track, event))
    clearLongPressTimers(event.pointerId)
    trackPanValues(endedTrack, event, false)
    pointers.delete(event.pointerId)
    releaseCapture(event.pointerId)
    const durationMs = event.timeStamp - endedTrack.startTime
    isClickSuppressed =
      endedTrack.pressState !== 'Pending' || durationMs >= MAX_TAP_DURATION_MS
    if (endedTrack.pressState === 'Activated') {
      return
    }
    const panEnd = PanEnd.make({
      translationX: event.clientX - endedTrack.startX,
      translationY: event.clientY - endedTrack.startY,
      velocityX: endedTrack.velocityX,
      velocityY: endedTrack.velocityY,
    })
    const maybeDirection = swipeDirection(panEnd)

    for (const gesture of readGestures()) {
      StrictGesture.match<void, StrictGesture<Message>>(gesture, {
        Tap: Function.constVoid,
        LongPress: Function.constVoid,
        Pan: ({ minDistance, onEnd }) => {
          if (endedTrack.distance >= (minDistance ?? DEFAULT_PAN_DISTANCE)) {
            isClickSuppressed = true
            emit(onEnd(panEnd))
          }
        },
        Swipe: ({ direction, onSwipe }) => {
          if (
            Option.isSome(maybeDirection) &&
            maybeDirection.value === direction
          ) {
            isClickSuppressed = true
            emit(onSwipe)
          }
        },
      })
    }
  }

  const click = (event: MouseEvent): void => {
    if (!isGestureTarget(event) || (event.detail !== 0 && isClickSuppressed)) {
      return
    }

    const tapCount = Math.max(1, event.detail)
    for (const gesture of readGestures()) {
      StrictGesture.match<void, StrictGesture<Message>>(gesture, {
        Tap: ({ numberOfTaps, onTap }) => {
          if (tapCount % Math.max(1, Math.floor(numberOfTaps ?? 1)) === 0) {
            emit(onTap)
          }
        },
        LongPress: Function.constVoid,
        Pan: Function.constVoid,
        Swipe: Function.constVoid,
      })
    }
  }

  element.addEventListener('pointerdown', pointerDown)
  element.addEventListener('pointermove', pointerMove)
  element.addEventListener('pointerup', pointerUp)
  element.addEventListener('pointercancel', pointerCancel)
  element.addEventListener('click', click)
  element.addEventListener('lostpointercapture', pointerCancel)

  return () => {
    element.removeEventListener('pointerdown', pointerDown)
    element.removeEventListener('pointermove', pointerMove)
    element.removeEventListener('pointerup', pointerUp)
    element.removeEventListener('pointercancel', pointerCancel)
    element.removeEventListener('click', click)
    element.removeEventListener('lostpointercapture', pointerCancel)

    const pointerIds = Array.fromIterable(pointers.keys())
    pointers.clear()
    for (const pointerId of pointerIds) {
      clearLongPressTimers(pointerId)
      releaseCapture(pointerId)
    }
  }
}
