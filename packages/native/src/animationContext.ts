import * as React from 'react'

import type { NativeAnimationHost } from './animationHost'

/** Supplies one runtime's shared-value registry to host adapters. @internal */
export const NativeAnimationContext = React.createContext<
  NativeAnimationHost | undefined
>(undefined)

/** Reads the registry installed by FoldkitRoot. @internal */
export const useNativeAnimationHost = (): NativeAnimationHost => {
  const host = React.useContext(NativeAnimationContext)
  if (host === undefined) {
    throw new Error('Native animated bindings require FoldkitRoot.')
  }
  return host
}
