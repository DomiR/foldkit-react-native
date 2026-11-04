import type { StrictStyle } from 'foldkit/strict'

const REDUCED_MOTION_TRANSITION_MS = 1
const REDUCED_MOTION_TRANSITION_DELAY_MS = 0

/** Shortens CSS transitions while preserving their end callbacks. @internal */
export const withReducedMotion = (
  style: StrictStyle,
  isReducedMotion: boolean,
): StrictStyle => {
  if (
    !isReducedMotion ||
    (style.transitionProperty === undefined &&
      style.transitionDuration === undefined &&
      style.transitionDelay === undefined &&
      style.transitionTimingFunction === undefined)
  ) {
    return style
  }

  return {
    ...style,
    transitionDuration: REDUCED_MOTION_TRANSITION_MS,
    transitionDelay: REDUCED_MOTION_TRANSITION_DELAY_MS,
  }
}
