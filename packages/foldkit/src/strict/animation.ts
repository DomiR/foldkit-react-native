import { Context, Effect, Schema } from 'effect'

import { defineTaggedUnion } from '../schema/index.js'
import type { StrictStyle } from './strict.js'

/** A serializable identity for a host-owned animated number. @experimental */
export const AnimatedValueKey = Schema.Struct({
  name: Schema.String,
  initial: Schema.Number,
})

/** A serializable identity for a host-owned animated number. @experimental */
export type AnimatedValueKey = typeof AnimatedValueKey.Type

/** Declares keys at module scope. Names identify values within one runtime.
 * Shared values belong to the host and never enter the Model. @experimental */
export const AnimatedValue = {
  key: (name: string, initial: number): AnimatedValueKey =>
    AnimatedValueKey.make({ name, initial }),
}

/** A module-scope mapper whose body begins with `'worklet'`. It maps an animated
 * number to portable styles and must have serializable captures. @experimental */
export type AnimatedStyleBinding = Readonly<{
  key: AnimatedValueKey
  mapper: (value: number) => StrictStyle
}>

/** Portable completion facts returned by animation Commands. @experimental */
export const AnimationResult = Schema.Struct({ isFinished: Schema.Boolean })

/** Portable completion facts returned by animation Commands. @experimental */
export type AnimationResult = typeof AnimationResult.Type

/** Portable spring and timing animation settings. @experimental */
export const StrictAnimation = defineTaggedUnion({
  Spring: {
    damping: Schema.optionalKey(Schema.Number),
    stiffness: Schema.optionalKey(Schema.Number),
  },
  Timing: { durationMs: Schema.Number },
})

/** Portable spring and timing animation settings. @experimental */
export type StrictAnimation = typeof StrictAnimation.Type

/** Describes a spring animation. @experimental */
export const Spring = StrictAnimation.Spring

/** Describes a linear animation with a duration in milliseconds. @experimental */
export const Timing = StrictAnimation.Timing

/** Portable entering and exiting animation descriptions. @experimental */
export const StrictLayoutAnimation = defineTaggedUnion({
  FadeIn: { durationMs: Schema.optionalKey(Schema.Number) },
  FadeOut: { durationMs: Schema.optionalKey(Schema.Number) },
  SlideInRight: { durationMs: Schema.optionalKey(Schema.Number) },
  SlideOutLeft: { durationMs: Schema.optionalKey(Schema.Number) },
  ZoomIn: { durationMs: Schema.optionalKey(Schema.Number) },
  ZoomOut: { durationMs: Schema.optionalKey(Schema.Number) },
})

/** Portable entering and exiting animation descriptions. @experimental */
export type StrictLayoutAnimation = typeof StrictLayoutAnimation.Type

/** Describes a fade from transparent. @experimental */
export const FadeIn = StrictLayoutAnimation.FadeIn
/** Describes a fade to transparent. @experimental */
export const FadeOut = StrictLayoutAnimation.FadeOut
/** Describes entry from the right. @experimental */
export const SlideInRight = StrictLayoutAnimation.SlideInRight
/** Describes exit to the left. @experimental */
export const SlideOutLeft = StrictLayoutAnimation.SlideOutLeft
/** Describes entry by growing from zero scale. @experimental */
export const ZoomIn = StrictLayoutAnimation.ZoomIn
/** Describes exit by shrinking to zero scale. @experimental */
export const ZoomOut = StrictLayoutAnimation.ZoomOut

/** Host animation operations for Commands. Replacing or canceling an animation
 * completes it with `isFinished: false`. @experimental */
export class AnimatedValues extends Context.Service<
  AnimatedValues,
  Readonly<{
    animateTo: (
      key: AnimatedValueKey,
      target: number,
      animation: StrictAnimation,
    ) => Effect.Effect<AnimationResult>
    set: (key: AnimatedValueKey, value: number) => Effect.Effect<void>
  }>
>()('foldkit/strict/AnimatedValues') {}

/** Executes a module-scope worklet on the host's background runtime.
 * Its body begins with `'worklet'`. Arguments, captures, and results must be serializable.
 * Failures are handled by the calling Command. @experimental */
export class BackgroundRuntime extends Context.Service<
  BackgroundRuntime,
  Readonly<{
    run: <Args extends Array<unknown>, Result>(
      worklet: (...args: Args) => Result,
      ...args: Args
    ) => Effect.Effect<Result, unknown>
  }>
>()('foldkit/strict/BackgroundRuntime') {}
