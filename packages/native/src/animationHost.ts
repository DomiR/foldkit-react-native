import { Array, Effect, Layer, Option } from 'effect'
import {
  AnimatedValues,
  BackgroundRuntime,
  type AnimatedValueKey,
  type AnimationResult,
} from 'foldkit/strict'
import {
  Easing,
  cancelAnimation,
  makeMutable,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated'
import {
  createWorkletRuntime,
  runOnRuntimeAsync,
  scheduleOnRN,
  scheduleOnUI,
  type WorkletRuntime,
} from 'react-native-worklets'

const DEFAULT_DAMPING = 20
const DEFAULT_STIFFNESS = 180

/** One native runtime's shared-value registry and background worklet Layer.
 * Pass the host to makeNativeProgram, which provides its Layer alongside application resources.
 * @experimental */
export type NativeAnimationHost = Readonly<{
  layer: Layer.Layer<AnimatedValues | BackgroundRuntime>
  mutable: (key: AnimatedValueKey) => SharedValue<number>
  dispose: () => void
}>

/** Creates lazy host resources for one Foldkit runtime. Shared values are
 * identified by key name, and background jobs share one worklet runtime.
 * @experimental */
export const makeNativeAnimationHost = (): NativeAnimationHost => {
  const values = new Map<string, SharedValue<number>>()
  const pending = new Set<(isFinished: boolean) => void>()
  const owners = new Map<string, (isFinished: boolean) => void>()
  let maybeRuntime = Option.none<WorkletRuntime>()
  let isDisposed = false
  const mutable = (key: AnimatedValueKey): SharedValue<number> => {
    const existing = values.get(key.name)
    if (existing !== undefined) {
      return existing
    }
    const value = makeMutable(key.initial)
    values.set(key.name, value)
    return value
  }
  const dispose = (): void => {
    if (isDisposed) {
      return
    }
    isDisposed = true
    for (const value of values.values()) {
      cancelAnimation(value)
    }
    for (const complete of Array.fromIterable(pending)) {
      complete(false)
    }
    values.clear()
    owners.clear()
    maybeRuntime = Option.none()
  }
  const service: typeof AnimatedValues.Service = {
    set: (key, value) =>
      Effect.sync(() => {
        if (!isDisposed) {
          const shared = mutable(key)
          cancelAnimation(shared)
          owners.get(key.name)?.(false)
          shared.value = value
        }
      }),
    animateTo: (key, target, animation) =>
      Effect.callback<AnimationResult>(resume => {
        if (isDisposed) {
          resume(Effect.succeed({ isFinished: false }))
          return
        }
        const shared = mutable(key)
        owners.get(key.name)?.(false)
        let isCompleted = false
        const complete = (isFinished: boolean): void => {
          if (isCompleted) {
            return
          }
          isCompleted = true
          pending.delete(complete)
          if (owners.get(key.name) === complete) {
            owners.delete(key.name)
          }
          resume(Effect.succeed({ isFinished }))
        }
        pending.add(complete)
        owners.set(key.name, complete)
        const isSpring = animation._tag === 'Spring'
        const duration = animation._tag === 'Timing' ? animation.durationMs : 0
        const damping =
          animation._tag === 'Spring'
            ? (animation.damping ?? DEFAULT_DAMPING)
            : DEFAULT_DAMPING
        const stiffness =
          animation._tag === 'Spring'
            ? (animation.stiffness ?? DEFAULT_STIFFNESS)
            : DEFAULT_STIFFNESS
        scheduleOnUI(() => {
          'worklet'
          const completed = (isFinished?: boolean) => {
            'worklet'
            scheduleOnRN(complete, isFinished === true)
          }
          shared.value = isSpring
            ? withSpring(target, { damping, stiffness, mass: 1 }, completed)
            : withTiming(target, { duration, easing: Easing.linear }, completed)
        })
        return Effect.sync(() => {
          if (!isCompleted) {
            if (owners.get(key.name) === complete) {
              cancelAnimation(shared)
            }
            complete(false)
          }
        })
      }),
  }
  const background: typeof BackgroundRuntime.Service = {
    run: (worklet, ...args) =>
      Effect.tryPromise(() => {
        if (isDisposed) {
          throw new Error('The native animation host is disposed.')
        }
        if (Option.isNone(maybeRuntime)) {
          maybeRuntime = Option.some(
            createWorkletRuntime({ name: 'Foldkit background' }),
          )
        }
        return runOnRuntimeAsync(
          Option.getOrThrow(maybeRuntime),
          worklet,
          ...args,
        )
      }),
  }
  return {
    mutable,
    dispose,
    layer: Layer.merge(
      Layer.effect(
        AnimatedValues,
        Effect.acquireRelease(Effect.succeed(service), () =>
          Effect.sync(dispose),
        ),
      ),
      Layer.succeed(BackgroundRuntime, background),
    ),
  }
}
