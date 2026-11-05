import * as React from 'react'
import { makeMutable, useAnimatedKeyboard } from 'react-native-reanimated'
import type { SharedValue } from 'react-native-reanimated'

const KeyboardHeightContext = React.createContext<SharedValue<number>>(
  makeMutable(0),
)

/** Provides the app's animated keyboard height. @internal */
export const NativeKeyboardProvider = ({
  children,
}: Readonly<{ children: React.ReactNode }>): React.ReactElement => {
  // NOTE: This hook takes over Android window insets, so its provider mounts once at the root.
  const { height } = useAnimatedKeyboard()

  return React.createElement(
    KeyboardHeightContext.Provider,
    { value: height },
    children,
  )
}

/** Reads the animated keyboard height, or zero outside the provider. @internal */
export const useKeyboardHeight = (): SharedValue<number> =>
  React.useContext(KeyboardHeightContext)
