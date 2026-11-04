import { Match } from 'effect'
import type { AccessibilityRole, AccessibilityState } from 'react-native'

import type { NativeAttributes, NativeTag } from './node'

/** Native accessibility semantics for a portable element. @internal */
export type NativeAccessibilityProps = Readonly<{
  accessibilityRole?: AccessibilityRole
  accessibilityLabel?: string
  accessibilityState?: AccessibilityState
}>

/** Maps portable element semantics to native accessibility props. @internal */
export const toAccessibilityProps = <Message>(
  tag: NativeTag,
  attributes: NativeAttributes<Message>,
): NativeAccessibilityProps => {
  const { ariaLabel, alt, isChecked, isDisabled, onClick } = attributes
  const accessibilityLabel = tag === 'img' ? (ariaLabel ?? alt) : ariaLabel
  const labelProps =
    accessibilityLabel === undefined ? {} : { accessibilityLabel }
  const isDisabledState = isDisabled === true

  return Match.value(tag).pipe(
    Match.withReturnType<NativeAccessibilityProps>(),
    Match.whenOr('h1', 'h2', 'h3', () => ({
      ...labelProps,
      accessibilityRole: 'header',
    })),
    Match.when('button', () => ({
      ...labelProps,
      accessibilityRole: 'button',
      accessibilityState: { disabled: isDisabledState },
    })),
    Match.when('input', () => {
      if (isChecked !== undefined) {
        return {
          ...labelProps,
          accessibilityRole: 'switch',
          accessibilityState: { checked: isChecked, disabled: isDisabledState },
        }
      } else {
        return {
          ...labelProps,
          accessibilityState: { disabled: isDisabledState },
        }
      }
    }),
    Match.when('img', () => ({
      ...labelProps,
      accessibilityRole: 'image',
    })),
    Match.orElse(() => {
      if (onClick !== undefined) {
        return {
          ...labelProps,
          accessibilityRole: 'button',
          accessibilityState: { disabled: isDisabledState },
        }
      } else {
        return labelProps
      }
    }),
  )
}
