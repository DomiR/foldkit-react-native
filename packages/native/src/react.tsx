import { Array, Match, Option, Predicate, Record } from 'effect'
import * as React from 'react'
import { Image, Pressable, Switch, Text, View } from 'react-native'
import type { TextStyle } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import Animated from 'react-native-reanimated'

import { toAccessibilityProps } from './accessibility'
import { NativeActiveContext } from './activeContext'
import {
  NativeAnimatedElement,
  type NativeMotion,
  toNativeStyle,
} from './animated'
import { NativeAnimationContext } from './animationContext'
import { NativeGestures } from './gestures'
import type { NativeInstrumentation } from './instrumentation'
import { NativeKeyboardProvider } from './keyboard'
import { unwrapLazy } from './lazy'
import { NativeList } from './list'
import { NativeStack, NativeTabs } from './navigation'
import type {
  NativeAttributes,
  NativeChild,
  NativeNode,
  NativeStyle,
} from './node'
import { withReducedMotion } from './reducedMotion'
import type { NativeProgram } from './runtime'
import { toTextAreaStyle } from './textArea'
import {
  NativeInputContext,
  NativeInputRevisionContext,
  NativeTextInput,
} from './textInput'
import { useReducedMotion } from './useReducedMotion'

declare const performance: Readonly<{ now: () => number }>

const AnimatedPressable = Animated.createAnimatedComponent(Pressable)
const AnimatedSwitch = Animated.createAnimatedComponent(Switch)

const toReactKey = <Message,>(
  lazyNode: NativeNode<Message>,
  ordinal: number,
): string | undefined => {
  const node = unwrapLazy(lazyNode)
  const identity = node._tag === 'Empty' ? undefined : node.identity
  const userKey =
    node._tag === 'Element' || node._tag === 'List' ? node.key : undefined

  if (identity !== undefined && userKey !== undefined) {
    return JSON.stringify([identity, 'key', userKey])
  } else if (identity !== undefined) {
    return JSON.stringify([identity, 'nth', ordinal])
  } else {
    return userKey
  }
}

const toChildReactKeys = <Message,>(
  children: ReadonlyArray<NativeChild<Message>>,
): ReadonlyArray<string | undefined> => {
  const identityOrdinals = new Map<string, number>()
  const [, keys] = Array.mapAccum(
    children,
    identityOrdinals,
    (identityOrdinals, child) => {
      if (
        child === null ||
        Predicate.isString(child) ||
        child._tag === 'Empty'
      ) {
        return [identityOrdinals, undefined]
      }

      const unwrapped = unwrapLazy(child)
      const identity =
        unwrapped._tag === 'Empty' ? undefined : unwrapped.identity
      if (identity === undefined) {
        return [identityOrdinals, toReactKey(child, 0)]
      }

      const ordinal = identityOrdinals.get(identity) ?? 0
      identityOrdinals.set(identity, ordinal + 1)
      return [identityOrdinals, toReactKey(child, ordinal)]
    },
  )

  return keys
}

const splitStyle = (
  style: NativeStyle | undefined,
  inheritedTextStyle: TextStyle,
  isReducedMotion: boolean,
) => {
  const {
    color,
    fontSize,
    fontWeight,
    fontStyle,
    lineHeight,
    letterSpacing,
    includeFontPadding,
    textAlign,
    textDecorationLine,
    ...layout
  } = toNativeStyle(withReducedMotion(style ?? {}, isReducedMotion))
  const text: TextStyle = {
    ...inheritedTextStyle,
    ...Record.filter(
      {
        color,
        fontSize,
        fontWeight,
        fontStyle,
        lineHeight,
        letterSpacing,
        includeFontPadding,
        textAlign,
        textDecorationLine,
      },
      Predicate.isNotUndefined,
    ),
  }

  return { layout, text }
}

const renderChild = <Message,>(
  child: NativeChild<Message>,
  dispatch: (message: Message) => void,
  isTextParent: boolean,
  textStyle: TextStyle,
  isActive: boolean,
  reactKey: string | undefined,
  isReducedMotion: boolean,
): React.ReactNode => {
  if (child === null) {
    return null
  }

  if (Predicate.isString(child)) {
    if (isTextParent) {
      return child
    } else {
      return React.createElement(Text, { style: textStyle }, child)
    }
  } else {
    return renderNode(
      child,
      dispatch,
      textStyle,
      isActive,
      reactKey,
      isReducedMotion,
    )
  }
}

const renderElement = <Message,>(
  node: Extract<NativeNode<Message>, Readonly<{ _tag: 'Element' }>>,
  dispatch: (message: Message) => void,
  inheritedTextStyle: TextStyle,
  isActive: boolean,
  reactKey: string | undefined,
  isReducedMotion: boolean,
  motion?: NativeMotion,
): React.ReactElement => {
  const { attributes, children } = node
  const { style, onClick, onInput, onSubmitEditing, isDisabled } = attributes
  const { layout, text } = splitStyle(
    style,
    inheritedTextStyle,
    isReducedMotion,
  )
  const onPress = onClick === undefined ? undefined : () => dispatch(onClick)
  const props = { key: reactKey, ...toAccessibilityProps(node.tag, attributes) }
  const motionProps =
    motion === undefined
      ? {}
      : {
          ...(motion.entering === undefined
            ? {}
            : { entering: motion.entering }),
          ...(motion.exiting === undefined ? {} : { exiting: motion.exiting }),
          ...(motion.onCSSTransitionEnd === undefined
            ? {}
            : { onCSSTransitionEnd: motion.onCSSTransitionEnd }),
        }
  const layoutStyle = layout
  const textStyle = { ...layout, ...text }
  const renderView = (
    props: React.ComponentProps<typeof View>,
    ...children: ReadonlyArray<React.ReactNode>
  ): React.ReactElement => {
    if (motion === undefined) {
      return React.createElement(View, props, ...children)
    } else {
      return React.createElement(
        Animated.View,
        { ...props, ...motionProps, style: [props.style, ...motion.styles] },
        ...children,
      )
    }
  }
  const renderText = (
    props: React.ComponentProps<typeof Text>,
    ...children: ReadonlyArray<React.ReactNode>
  ): React.ReactElement => {
    if (motion === undefined) {
      return React.createElement(Text, props, ...children)
    } else {
      return React.createElement(
        Animated.Text,
        { ...props, ...motionProps, style: [props.style, ...motion.styles] },
        ...children,
      )
    }
  }
  const renderPressable = (
    props: Omit<React.ComponentProps<typeof Pressable>, 'style'> &
      Readonly<{ style: typeof layout }>,
    ...children: ReadonlyArray<React.ReactNode>
  ): React.ReactElement => {
    if (motion === undefined) {
      return React.createElement(Pressable, props, ...children)
    } else {
      return React.createElement(
        AnimatedPressable,
        { ...props, ...motionProps, style: [props.style, ...motion.styles] },
        ...children,
      )
    }
  }
  const renderSwitch = (
    props: React.ComponentProps<typeof Switch>,
    ...children: ReadonlyArray<React.ReactNode>
  ): React.ReactElement => {
    if (motion === undefined) {
      return React.createElement(Switch, props, ...children)
    } else {
      return React.createElement(
        AnimatedSwitch,
        { ...props, ...motionProps, style: [props.style, ...motion.styles] },
        ...children,
      )
    }
  }
  const renderImage = (
    props: React.ComponentProps<typeof Image>,
    ...children: ReadonlyArray<React.ReactNode>
  ): React.ReactElement => {
    if (motion === undefined) {
      return React.createElement(Image, props, ...children)
    } else {
      return React.createElement(
        Animated.Image,
        { ...props, ...motionProps, style: [props.style, ...motion.styles] },
        ...children,
      )
    }
  }
  const childReactKeys = toChildReactKeys(children)
  const renderChildren = (isTextParent: boolean) =>
    Array.zipWith(children, childReactKeys, (child, reactKey) =>
      renderChild(
        child,
        dispatch,
        isTextParent,
        text,
        isActive,
        reactKey,
        isReducedMotion,
      ),
    )

  return Match.value(node).pipe(
    Match.withReturnType<React.ReactElement>(),
    Match.whenOr(
      { tag: 'div' },
      { tag: 'ul' },
      { tag: 'li' },
      { tag: 'footer' },
      () =>
        onPress === undefined
          ? renderView(
              { ...props, style: layoutStyle },
              ...renderChildren(false),
            )
          : renderPressable(
              { ...props, style: layoutStyle, onPress, disabled: isDisabled },
              ...renderChildren(false),
            ),
    ),
    Match.whenOr(
      { tag: 'p' },
      { tag: 'span' },
      { tag: 'h1' },
      { tag: 'h2' },
      { tag: 'h3' },
      { tag: 'label' },
      () =>
        renderText(
          {
            ...props,
            style: textStyle,
            onPress,
            disabled: isDisabled,
          },
          ...renderChildren(true),
        ),
    ),
    Match.when({ tag: 'button' }, () =>
      renderPressable(
        {
          ...props,
          style: layoutStyle,
          onPress,
          disabled: isDisabled,
        },
        ...renderChildren(false),
      ),
    ),
    Match.when({ tag: 'input' }, () => {
      if (attributes.isChecked !== undefined) {
        const {
          margin,
          marginHorizontal,
          marginVertical,
          marginTop,
          marginRight,
          marginBottom,
          marginLeft,
          opacity,
        } = layout
        return renderSwitch({
          ...props,
          style: {
            alignSelf: 'center',
            flexGrow: 0,
            flexShrink: 0,
            margin,
            marginHorizontal,
            marginVertical,
            marginTop,
            marginRight,
            marginBottom,
            marginLeft,
            opacity,
          },
          value: attributes.isChecked,
          disabled: isDisabled,
          onValueChange: onPress,
        })
      } else {
        return React.createElement(NativeTextInput, {
          motion,
          ...props,
          style: textStyle,
          value: attributes.value,
          placeholder: attributes.placeholder,
          editable: !isDisabled,
          underlineColorAndroid: 'transparent',
          onChangeText:
            onInput === undefined
              ? undefined
              : value => dispatch(onInput(value)),
          onSubmitEditing:
            onSubmitEditing === undefined
              ? undefined
              : () => dispatch(onSubmitEditing),
        })
      }
    }),
    Match.when({ tag: 'textarea' }, () =>
      React.createElement(NativeTextInput, {
        motion,
        ...props,
        style: toTextAreaStyle(attributes.rows, textStyle),
        value: attributes.value,
        placeholder: attributes.placeholder,
        editable: !isDisabled,
        underlineColorAndroid: 'transparent',
        multiline: true,
        textAlignVertical: 'top',
        submitBehavior: 'newline',
        numberOfLines: attributes.rows,
        onChangeText:
          onInput === undefined ? undefined : value => dispatch(onInput(value)),
      }),
    ),
    Match.when({ tag: 'img' }, () =>
      renderImage({
        ...props,
        accessible: props.accessibilityLabel !== undefined,
        style: layoutStyle,
        source:
          attributes.src === undefined ? undefined : { uri: attributes.src },
      }),
    ),
    Match.exhaustive,
  )
}

const isTextStyleEqual = (previous: TextStyle, next: TextStyle): boolean => {
  const previousEntries = Object.entries(previous)
  const nextValues = new Map(Object.entries(next))
  return (
    previousEntries.length === nextValues.size &&
    previousEntries.every(
      ([key, value]) => nextValues.has(key) && nextValues.get(key) === value,
    )
  )
}

const useStableTextStyle = (textStyle: TextStyle): TextStyle => {
  const stable = React.useRef(textStyle)
  if (!isTextStyleEqual(stable.current, textStyle)) {
    stable.current = textStyle
  }
  return stable.current
}

/** Skips a reused Lazy subtree. Returning the same React element lets React
 * bail out of the whole subtree. Activity reaches the subtree through context,
 * so selecting another tab re-renders only the components that act on it. */
const NativeLazy = <Message,>({
  node,
  dispatch,
  textStyle,
  isActive,
  isReducedMotion,
}: Readonly<{
  node: NativeNode<Message>
  dispatch: (message: Message) => void
  textStyle: TextStyle
  isActive: boolean
  isReducedMotion: boolean
}>): React.ReactElement => {
  const isParentActive = React.useContext(NativeActiveContext)
  const stableTextStyle = useStableTextStyle(textStyle)
  const element = React.useMemo(
    () =>
      renderNode(
        node,
        dispatch,
        stableTextStyle,
        true,
        undefined,
        isReducedMotion,
      ),
    [node, dispatch, stableTextStyle, isReducedMotion],
  )

  return React.createElement(
    NativeActiveContext.Provider,
    { value: isParentActive && isActive },
    element,
  )
}

const renderNode = <Message,>(
  node: NativeNode<Message>,
  dispatch: (message: Message) => void,
  inheritedTextStyle: TextStyle,
  isActive: boolean,
  reactKey: string | undefined,
  isReducedMotion: boolean,
): React.ReactElement | null => {
  const renderContent = (
    attributes: NativeAttributes<Message>,
    children: ReadonlyArray<NativeChild<Message>>,
    isChildActive: boolean,
  ) =>
    renderNode(
      { _tag: 'Element', tag: 'div', key: undefined, attributes, children },
      dispatch,
      inheritedTextStyle,
      isChildActive,
      undefined,
      isReducedMotion,
    )
  const gestures =
    node._tag === 'Empty' || node._tag === 'Lazy'
      ? undefined
      : node.attributes.gestures
  const hasGestures =
    gestures !== undefined && Array.isReadonlyArrayNonEmpty(gestures)
  const nodeReactKey = hasGestures ? undefined : reactKey
  const rendered = Match.value(node).pipe(
    Match.withReturnType<React.ReactElement | null>(),
    Match.tagsExhaustive({
      Empty: () => null,
      Lazy: ({ node }) =>
        React.createElement(NativeLazy<Message>, {
          key: reactKey,
          node,
          dispatch,
          textStyle: inheritedTextStyle,
          isActive,
          isReducedMotion,
        }),
      Element: element => {
        const { attributes } = element
        const style = attributes.style
        const isAnimated =
          attributes.entering !== undefined ||
          attributes.exiting !== undefined ||
          attributes.onTransitionEnd !== undefined ||
          Array.isReadonlyArrayNonEmpty(attributes.animatedStyles ?? []) ||
          style?.transitionProperty !== undefined ||
          style?.transitionDuration !== undefined ||
          style?.transitionDelay !== undefined ||
          style?.transitionTimingFunction !== undefined
        if (isAnimated) {
          return React.createElement(NativeAnimatedElement<Message>, {
            key: nodeReactKey,
            attributes,
            dispatch,
            children: motion =>
              renderElement(
                element,
                dispatch,
                inheritedTextStyle,
                isActive,
                undefined,
                isReducedMotion,
                motion,
              ),
          })
        } else {
          return renderElement(
            element,
            dispatch,
            inheritedTextStyle,
            isActive,
            nodeReactKey,
            isReducedMotion,
          )
        }
      },
      List: node => {
        const { layout, text: textStyle } = splitStyle(
          node.attributes.style,
          inheritedTextStyle,
          isReducedMotion,
        )

        return React.createElement(NativeList<Message>, {
          key: nodeReactKey ?? node.key,
          node,
          layout,
          dispatch,
          isActive,
          renderRow: child =>
            renderNode(
              child,
              dispatch,
              textStyle,
              isActive,
              toReactKey(child, 0),
              isReducedMotion,
            ),
        })
      },
      Stack: node =>
        React.createElement(NativeStack<Message>, {
          node,
          dispatch,
          renderContent,
          isActive,
          key: nodeReactKey,
        }),
      Tabs: node =>
        React.createElement(NativeTabs<Message>, {
          node,
          dispatch,
          renderContent,
          isActive,
          key: nodeReactKey,
        }),
    }),
  )

  if (node._tag === 'Empty' || rendered === null) {
    return null
  }

  if (node._tag === 'List' || node._tag === 'Lazy') {
    return rendered
  }

  if (hasGestures && gestures !== undefined) {
    return React.createElement(NativeGestures<Message>, {
      key: reactKey,
      gestures,
      dispatch,
      children: rendered,
    })
  } else {
    return rendered
  }
}

const renderRoot = <Model, Message>(
  node: NativeNode<Message>,
  program: NativeProgram<Model, Message>,
  isReducedMotion: boolean,
): React.ReactElement | null =>
  React.createElement(
    NativeAnimationContext.Provider,
    { value: program.animationHost },
    React.createElement(
      NativeInputContext.Provider,
      { value: program.recordInputEvent },
      React.createElement(
        NativeInputRevisionContext.Provider,
        { value: program.getSnapshotInputRevision() },
        React.createElement(
          GestureHandlerRootView,
          { style: { flex: 1 } },
          React.createElement(NativeKeyboardProvider, {
            children: renderNode(
              node,
              program.dispatch,
              {},
              true,
              toReactKey(node, 0),
              isReducedMotion,
            ),
          }),
        ),
      ),
    ),
  )

const NativeRoot = <Model, Message>({
  program,
}: Readonly<{
  program: NativeProgram<Model, Message>
}>): React.ReactElement | null => {
  const isReducedMotion = useReducedMotion()
  const node = React.useSyncExternalStore(
    program.subscribe,
    program.getSnapshot,
  )

  React.useLayoutEffect(() => {
    program.acknowledgeCommittedSnapshot(node)
  }, [program, node])

  return renderRoot(node, program, isReducedMotion)
}

const InstrumentedNativeRoot = <Model, Message>({
  program,
  instrumentation,
}: Readonly<{
  program: NativeProgram<Model, Message>
  instrumentation: NativeInstrumentation
}>): React.ReactElement | null => {
  const isReducedMotion = useReducedMotion()
  const node = React.useSyncExternalStore(
    program.subscribe,
    program.getSnapshot,
  )

  React.useLayoutEffect(() => {
    program.acknowledgeCommittedSnapshot(node)
  }, [program, node])

  React.useLayoutEffect(() => {
    instrumentation.onCommit(performance.now())
  }, [instrumentation, node])

  return renderRoot(node, program, isReducedMotion)
}

/** Subscribes to native frames and renders them inside a GestureHandlerRootView. */
export const FoldkitRoot = <Model, Message>({
  program,
}: Readonly<{
  program: NativeProgram<Model, Message>
}>): React.ReactElement | null =>
  Option.match(program.maybeInstrumentation, {
    onNone: () => React.createElement(NativeRoot<Model, Message>, { program }),
    onSome: instrumentation =>
      React.createElement(InstrumentedNativeRoot<Model, Message>, {
        program,
        instrumentation,
      }),
  })
