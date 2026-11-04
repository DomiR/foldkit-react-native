import { Array, Option, Predicate } from 'effect'
import type { TextStyle } from 'react-native'

const DEFAULT_FONT_SIZE = 14
const LINE_HEIGHT_RATIO = 1.2

const firstDefinedNumber = (...values: ReadonlyArray<unknown>): number => {
  const maybeValue = Array.findFirst(values, Predicate.isNotUndefined)
  if (Option.isNone(maybeValue)) {
    return 0
  }

  return Predicate.isNumber(maybeValue.value) ? maybeValue.value : 0
}

/** Computes a minimum native textarea height from its row count. @internal */
export const toTextAreaStyle = (
  rows: number | undefined,
  style: TextStyle,
): TextStyle => {
  if (
    rows === undefined ||
    style.height !== undefined ||
    style.minHeight !== undefined
  ) {
    return style
  }

  const lineHeight =
    style.lineHeight ??
    (style.fontSize ?? DEFAULT_FONT_SIZE) * LINE_HEIGHT_RATIO
  const paddingTop = firstDefinedNumber(
    style.paddingTop,
    style.paddingVertical,
    style.padding,
  )
  const paddingBottom = firstDefinedNumber(
    style.paddingBottom,
    style.paddingVertical,
    style.padding,
  )
  const borderWidth = firstDefinedNumber(style.borderWidth)

  return {
    ...style,
    minHeight: rows * lineHeight + paddingTop + paddingBottom + 2 * borderWidth,
  }
}
