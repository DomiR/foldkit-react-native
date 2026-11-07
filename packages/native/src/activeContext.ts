import * as React from 'react'

/** Whether the enclosing Lazy subtree is active. A Lazy node passes its
 * activity through context so a change in activity, such as selecting another
 * tab, does not re-render the cached subtree. Components that act on activity
 * combine their `isActive` prop with this value. @internal */
export const NativeActiveContext = React.createContext(true)

/** Combines an `isActive` prop with the activity of the enclosing Lazy subtree. @internal */
export const useIsActive = (isActive: boolean): boolean =>
  React.useContext(NativeActiveContext) && isActive
