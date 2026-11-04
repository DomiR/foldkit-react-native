import * as React from 'react'
import { AccessibilityInfo } from 'react-native'

/** Tracks the system reduced-motion preference. @internal */
export const useReducedMotion = (): boolean => {
  const [isReducedMotion, setIsReducedMotion] = React.useState(false)

  React.useEffect(() => {
    let isMounted = true
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setIsReducedMotion,
    )

    void AccessibilityInfo.isReduceMotionEnabled().then(isEnabled => {
      if (isMounted) {
        setIsReducedMotion(isEnabled)
      }
    })

    return () => {
      isMounted = false
      subscription.remove()
    }
  }, [])

  return isReducedMotion
}
