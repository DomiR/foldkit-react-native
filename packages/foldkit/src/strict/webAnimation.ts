import { Array, Effect, Layer, Option, Predicate } from 'effect'

import {
  AnimatedValues,
  BackgroundRuntime,
  type AnimatedValueKey,
  type AnimationResult,
  type StrictAnimation,
} from './animation.js'

const DEFAULT_DAMPING = 20
const DEFAULT_STIFFNESS = 180
const MAX_FRAME_MS = 64
const STEP_SECONDS = 1 / 120
const MILLIS_PER_SECOND = 1000
const SPRING_TOLERANCE = 0.1
const MAX_SPRING_MS = 10000
const prefersReducedMotion = (): boolean => {
  const matchMedia = globalThis.matchMedia
  return (
    Predicate.isFunction(matchMedia) &&
    matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/** One web runtime's animation registry and resource Layer. Bindings use its
 * frame notifications; application code uses its services inside Commands.
 * @experimental */
export type WebAnimationHost = Readonly<{
  layer: Layer.Layer<AnimatedValues | BackgroundRuntime>
  read: (key: AnimatedValueKey) => number
  write: (key: AnimatedValueKey, value: number) => void
  subscribe: (listener: () => void) => () => void
  dispose: () => void
}>

/** Creates a registry for one runtime. Springs use unit mass. Background
 * worklets run on the main thread after allowing the next frame to paint.
 * When reduced motion is active, animateTo writes its target and resolves
 * without requesting animation frames. Disposing the resource Layer cancels
 * frames and pending animations.
 * @experimental */
export const makeWebAnimationHost = (): WebAnimationHost => {
  const values = new Map<string, number>()
  const animations = new Map<string, () => void>()
  const listeners = new Set<() => void>()
  let isDisposed = false

  const read = (key: AnimatedValueKey): number => {
    const value = values.get(key.name)
    if (value !== undefined) {
      return value
    }
    if (!isDisposed) {
      values.set(key.name, key.initial)
    }
    return key.initial
  }
  const notify = (): void => {
    for (const listener of Array.fromIterable(listeners)) {
      listener()
    }
  }
  const cancel = (name: string): void => {
    animations.get(name)?.()
  }
  const write = (key: AnimatedValueKey, value: number): void => {
    if (isDisposed) {
      return
    }
    cancel(key.name)
    values.set(key.name, value)
    notify()
  }
  const animateTo = (
    key: AnimatedValueKey,
    target: number,
    animation: StrictAnimation,
  ): Effect.Effect<AnimationResult> =>
    Effect.callback(resume => {
      if (isDisposed) {
        resume(Effect.succeed({ isFinished: false }))
        return
      }
      cancel(key.name)
      if (prefersReducedMotion()) {
        values.set(key.name, target)
        notify()
        resume(Effect.succeed({ isFinished: true }))
        return
      }
      const initial = read(key)
      let position = initial
      let velocity = 0
      let elapsed = 0
      let maybePreviousTime = Option.none<number>()
      let maybeFrame = Option.none<number>()
      let isSettled = false
      const finish = (isFinished: boolean): void => {
        if (isSettled) {
          return
        }
        isSettled = true
        if (Option.isSome(maybeFrame)) {
          cancelAnimationFrame(maybeFrame.value)
        }
        animations.delete(key.name)
        resume(Effect.succeed({ isFinished }))
      }
      const frame = (time: number): void => {
        const frameMs = Option.match(maybePreviousTime, {
          onNone: () => 0,
          onSome: previousTime => Math.max(0, time - previousTime),
        })
        maybePreviousTime = Option.some(time)
        elapsed += frameMs
        let isFinished = false
        if (animation._tag === 'Timing') {
          const progress =
            animation.durationMs <= 0
              ? 1
              : Math.min(1, elapsed / animation.durationMs)
          position = initial + (target - initial) * progress
          isFinished = progress >= 1
        } else {
          let remaining = Math.min(frameMs, MAX_FRAME_MS) / MILLIS_PER_SECOND
          while (remaining > 0) {
            const step = Math.min(remaining, STEP_SECONDS)
            velocity +=
              (-(animation.stiffness ?? DEFAULT_STIFFNESS) *
                (position - target) -
                (animation.damping ?? DEFAULT_DAMPING) * velocity) *
              step
            position += velocity * step
            remaining -= step
          }
          isFinished =
            (Math.abs(position - target) < SPRING_TOLERANCE &&
              Math.abs(velocity) < SPRING_TOLERANCE) ||
            elapsed >= MAX_SPRING_MS
        }
        values.set(key.name, isFinished ? target : position)
        notify()
        if (isFinished) {
          finish(true)
        } else {
          maybeFrame = Option.some(requestAnimationFrame(frame))
        }
      }
      animations.set(key.name, () => finish(false))
      maybeFrame = Option.some(requestAnimationFrame(frame))
      return Effect.sync(() => finish(false))
    })
  const dispose = (): void => {
    if (isDisposed) {
      return
    }
    isDisposed = true
    for (const cancelAnimation of Array.fromIterable(animations.values())) {
      cancelAnimation()
    }
    listeners.clear()
    values.clear()
  }
  const background: typeof BackgroundRuntime.Service = {
    run: (worklet, ...args) =>
      Effect.callback(resume => {
        let frame = requestAnimationFrame(() => {
          frame = requestAnimationFrame(() =>
            resume(Effect.try(() => worklet(...args))),
          )
        })
        return Effect.sync(() => cancelAnimationFrame(frame))
      }),
  }
  return {
    layer: Layer.merge(
      Layer.effect(
        AnimatedValues,
        Effect.acquireRelease(
          Effect.sync(() => ({
            animateTo,
            set: (key: AnimatedValueKey, value: number) =>
              Effect.sync(() => write(key, value)),
          })),
          () => Effect.sync(dispose),
        ),
      ),
      Layer.succeed(BackgroundRuntime, background),
    ),
    read,
    write,
    dispose,
    subscribe: listener => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
