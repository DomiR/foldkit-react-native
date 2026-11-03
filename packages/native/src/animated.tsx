import { Array } from 'effect'
import {
  StrictLayoutAnimation,
  type AnimatedStyleBinding,
  type StrictStyle,
} from 'foldkit/strict'
import * as React from 'react'
import {
  FadeIn,
  FadeOut,
  SlideInRight,
  SlideOutLeft,
  ZoomIn,
  ZoomOut,
  useAnimatedStyle,
} from 'react-native-reanimated'

import { useNativeAnimationHost } from './animationContext'
import type { NativeAttributes } from './node'

const DEFAULT_LAYOUT_DURATION_MS = 300

/** Copies portable readonly arrays into Reanimated's style representation. @internal */
export const toNativeStyle = (style: StrictStyle) => {
  'worklet'
  const { transform, transitionProperty, ...properties } = style
  const nativeStyle = {
    ...properties,
    ...(transform === undefined
      ? {}
      : { transform: transform.map(operation => ({ ...operation })) }),
  }

  if (transitionProperty === undefined) {
    return nativeStyle
  } else if (transitionProperty === 'none') {
    return { ...nativeStyle, transitionProperty }
  } else {
    return { ...nativeStyle, transitionProperty: [transitionProperty].flat() }
  }
}

const layoutAnimation = (animation: StrictLayoutAnimation) =>
  StrictLayoutAnimation.match(animation, {
    FadeIn: ({ durationMs }) =>
      FadeIn.duration(durationMs ?? DEFAULT_LAYOUT_DURATION_MS),
    FadeOut: ({ durationMs }) =>
      FadeOut.duration(durationMs ?? DEFAULT_LAYOUT_DURATION_MS),
    SlideInRight: ({ durationMs }) =>
      SlideInRight.duration(durationMs ?? DEFAULT_LAYOUT_DURATION_MS),
    SlideOutLeft: ({ durationMs }) =>
      SlideOutLeft.duration(durationMs ?? DEFAULT_LAYOUT_DURATION_MS),
    ZoomIn: ({ durationMs }) =>
      ZoomIn.duration(durationMs ?? DEFAULT_LAYOUT_DURATION_MS),
    ZoomOut: ({ durationMs }) =>
      ZoomOut.duration(durationMs ?? DEFAULT_LAYOUT_DURATION_MS),
  })

/** Animated styles and layout callbacks consumed by a native element. @internal */
export type NativeMotion = Readonly<{
  styles: ReadonlyArray<
    ReturnType<typeof useAnimatedStyle<ReturnType<typeof toNativeStyle>>>
  >
  entering: ReturnType<typeof layoutAnimation> | undefined
  exiting: ReturnType<typeof layoutAnimation> | undefined
  onCSSTransitionEnd: (() => void) | undefined
}>

type StyleChainProps = Readonly<{
  bindings: ReadonlyArray<AnimatedStyleBinding>
  styles: NativeMotion['styles']
  children: (styles: NativeMotion['styles']) => React.ReactElement
}>

const StyleBinding = ({
  binding,
  children,
}: Readonly<{
  binding: AnimatedStyleBinding
  children: (
    style: ReturnType<
      typeof useAnimatedStyle<ReturnType<typeof toNativeStyle>>
    >,
  ) => React.ReactElement
}>): React.ReactElement => {
  const host = useNativeAnimationHost()
  const shared = host.mutable(binding.key)
  const { mapper } = binding
  const style = useAnimatedStyle(() => {
    'worklet'
    return toNativeStyle(mapper(shared.value))
  }, [shared, mapper])
  return children(style)
}

const StyleChain = ({
  bindings,
  styles,
  children,
}: StyleChainProps): React.ReactElement =>
  Array.matchLeft(bindings, {
    onEmpty: () => children(styles),
    onNonEmpty: (binding, remaining) => (
      <StyleBinding binding={binding}>
        {style => (
          <StyleChain bindings={remaining} styles={[...styles, style]}>
            {children}
          </StyleChain>
        )}
      </StyleBinding>
    ),
  })

/** Installs UI-thread style mappers without putting shared values in React state. @internal */
export const NativeAnimatedElement = <Message,>({
  attributes,
  dispatch,
  children,
}: Readonly<{
  attributes: NativeAttributes<Message>
  dispatch: (message: Message) => void
  children: (motion: NativeMotion) => React.ReactElement
}>): React.ReactElement => {
  const { entering, exiting, onTransitionEnd } = attributes
  const enteringAnimation = React.useMemo(
    () => (entering === undefined ? undefined : layoutAnimation(entering)),
    [entering?._tag, entering?.durationMs],
  )
  const exitingAnimation = React.useMemo(
    () => (exiting === undefined ? undefined : layoutAnimation(exiting)),
    [exiting?._tag, exiting?.durationMs],
  )
  return (
    <StyleChain bindings={attributes.animatedStyles ?? []} styles={[]}>
      {styles =>
        children({
          styles,
          entering: enteringAnimation,
          exiting: exitingAnimation,
          onCSSTransitionEnd:
            onTransitionEnd === undefined
              ? undefined
              : () => dispatch(onTransitionEnd),
        })
      }
    </StyleChain>
  )
}
