import { Schema } from 'effect'
import * as React from 'react'
import { TextInput } from 'react-native'
import Animated from 'react-native-reanimated'

import type { NativeMotion } from './animated'

const AnimatedInput = Animated.createAnimatedComponent(TextInput)

const InputState = Schema.Struct({
  modelValue: Schema.Union([Schema.String, Schema.Undefined]),
  modelRevision: Schema.Number,
  nativeValue: Schema.String,
  nativeRevision: Schema.Number,
})
type InputState = typeof InputState.Type

/** Orders native text reports and Model frames within one runtime. @internal */
export const NativeInputContext = React.createContext<() => number>(() => 0)

/** Retains native text until a Model frame includes that edit. A subsequent
 * Model value, including a clear, becomes authoritative. @internal */
export const NativeTextInput = ({
  value,
  onChangeText,
  motion,
  renderRevision,
  ...props
}: Omit<React.ComponentProps<typeof TextInput>, 'value' | 'onChangeText'> &
  Readonly<{
    value: string | undefined
    onChangeText: ((value: string) => void) | undefined
    motion: NativeMotion | undefined
    renderRevision: number
  }>): React.ReactElement => {
  const recordInputEvent = React.useContext(NativeInputContext)
  const [state, setState] = React.useState<InputState>(() =>
    InputState.make({
      modelValue: value,
      modelRevision: renderRevision,
      nativeValue: value ?? props.defaultValue ?? '',
      nativeRevision: renderRevision,
    }),
  )
  const isNewFrame =
    value !== state.modelValue || renderRevision !== state.modelRevision
  const nativeValue =
    renderRevision >= state.nativeRevision
      ? (value ?? state.nativeValue)
      : state.nativeValue
  const current = isNewFrame
    ? InputState.make({
        ...state,
        modelValue: value,
        modelRevision: renderRevision,
        nativeValue,
      })
    : state

  if (current !== state) {
    setState(current)
  }

  const handleChangeText = (nativeValue: string): void => {
    const nativeRevision = recordInputEvent()
    setState(previous =>
      InputState.make({ ...previous, nativeValue, nativeRevision }),
    )
    onChangeText?.(nativeValue)
  }
  const inputProps = {
    ...props,
    value: current.nativeValue,
    onChangeText: handleChangeText,
  }

  if (motion === undefined) {
    return <TextInput {...inputProps} />
  } else {
    return (
      <AnimatedInput
        {...inputProps}
        {...(motion.entering === undefined
          ? {}
          : { entering: motion.entering })}
        {...(motion.exiting === undefined ? {} : { exiting: motion.exiting })}
        {...(motion.onCSSTransitionEnd === undefined
          ? {}
          : { onCSSTransitionEnd: motion.onCSSTransitionEnd })}
        style={[props.style, ...motion.styles]}
      />
    )
  }
}
