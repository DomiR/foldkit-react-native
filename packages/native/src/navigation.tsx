import { Array, Option, Predicate } from 'effect'
import * as React from 'react'
import {
  BackHandler,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native'
import type { HostInstance } from 'react-native'
import Animated, {
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated'
import { ScreenStack, ScreenStackItem, Tabs } from 'react-native-screens'
import { SafeAreaView } from 'react-native-screens/experimental'

import { useIsActive } from './activeContext'
import { collectNativeAttributes } from './builder'
import { useKeyboardHeight } from './keyboard'
import { unwrapLazy } from './lazy'
import { ListScrollContext } from './list'
import type {
  NativeAttributes,
  NativeChild,
  NativeNode,
  NativeTab,
} from './node'
import { liftStickyFooter } from './stickyFooter'
import { useAndroidTabIcons } from './tabIcons'

type StackNode<Message> = Extract<
  NativeNode<Message>,
  Readonly<{ _tag: 'Stack' }>
>
type TabsNode<Message> = Extract<
  NativeNode<Message>,
  Readonly<{ _tag: 'Tabs' }>
>
type RenderContent<Message> = (
  attributes: NativeAttributes<Message>,
  children: ReadonlyArray<NativeChild<Message>>,
  isActive: boolean,
) => React.ReactNode

const isNavigationContent = <Message,>(
  children: ReadonlyArray<NativeChild<Message>>,
): boolean =>
  children.some(
    child =>
      child !== null &&
      !Predicate.isString(child) &&
      (unwrapLazy(child)._tag === 'Stack' || unwrapLazy(child)._tag === 'Tabs'),
  )

const containsList = <Message,>(
  children: ReadonlyArray<NativeChild<Message>>,
): boolean =>
  Array.some(children, child => {
    if (child === null || Predicate.isString(child)) {
      return false
    }

    const node = unwrapLazy(child)
    return (
      node._tag === 'List' ||
      (node._tag === 'Element' && containsList(node.children))
    )
  })

const NavigationBackgroundContext = React.createContext('#ffffff')
const StackUpdatesContext = React.createContext(true)

const KeyboardColumn = ({
  children,
  footer,
  isActive,
}: Readonly<{
  children: React.ReactNode
  footer: React.ReactNode
  isActive: boolean
}>): React.ReactElement => {
  const keyboardHeight = useKeyboardHeight()
  const bottomGap = useSharedValue(0)
  const columnRef = React.useRef<HostInstance>(null)
  const { height: windowHeight, width: windowWidth } = useWindowDimensions()
  const measureBottomGap = React.useCallback(() => {
    columnRef.current?.measureInWindow((_x, y, _width, height) => {
      bottomGap.value = Math.max(0, windowHeight - y - height)
    })
  }, [bottomGap, windowHeight])

  React.useLayoutEffect(measureBottomGap, [
    measureBottomGap,
    windowWidth,
    isActive,
  ])

  const keyboardStyle = useAnimatedStyle(() => ({
    paddingBottom: Math.max(0, keyboardHeight.value - bottomGap.value),
  }))

  return (
    <Animated.View
      ref={columnRef}
      collapsable={false}
      onLayout={measureBottomGap}
      style={[styles.fill, keyboardStyle]}
    >
      <View style={styles.fill}>{children}</View>
      {footer}
    </Animated.View>
  )
}

const NavigationBody = <Message,>({
  attributes,
  children,
  renderContent,
  isActive,
  isStackScreen = false,
}: Readonly<{
  attributes: NativeAttributes<Message>
  children: ReadonlyArray<NativeChild<Message>>
  renderContent: RenderContent<Message>
  isActive: boolean
  isStackScreen?: boolean
}>): React.ReactElement => {
  const isNavigation = isNavigationContent(children)
  const { flex: _flex, ...contentStyle } = attributes.style ?? {}
  const style = isNavigation ? { ...contentStyle, flex: 1 } : contentStyle

  if (isNavigation) {
    return (
      <View style={styles.fill}>
        {renderContent({ ...attributes, style }, children, isActive)}
      </View>
    )
  }

  const maybeFooterLift = liftStickyFooter(children)
  const bodyChildren = Option.match(maybeFooterLift, {
    onNone: () => children,
    onSome: footerLift => footerLift.children,
  })
  const isKeyboardColumn =
    Platform.OS === 'android' || Option.isSome(maybeFooterLift)

  // NOTE: RN keyboard adjustment clamps against contentInset, excluding automatic
  // header insets. Stack screens apply safe-area spacing outside the ScrollView.
  const body = containsList(bodyChildren) ? (
    <ListScrollContext.Provider
      value={{
        contentInsetAdjustmentBehavior: isStackScreen ? 'never' : 'automatic',
        automaticallyAdjustKeyboardInsets: !isKeyboardColumn,
      }}
    >
      <View style={styles.fill}>
        {renderContent(
          {
            ...attributes,
            style: { ...contentStyle, flex: 1, minHeight: 0 },
          },
          bodyChildren,
          isActive,
        )}
      </View>
    </ListScrollContext.Provider>
  ) : (
    <ScrollView
      style={styles.fill}
      contentContainerStyle={styles.content}
      removeClippedSubviews={false}
      automaticallyAdjustKeyboardInsets={!isKeyboardColumn}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      contentInsetAdjustmentBehavior={isStackScreen ? 'never' : 'automatic'}
      automaticallyAdjustsScrollIndicatorInsets
    >
      {renderContent({ ...attributes, style }, bodyChildren, isActive)}
    </ScrollView>
  )

  if (isKeyboardColumn) {
    return (
      <KeyboardColumn
        isActive={isActive}
        footer={Option.match(maybeFooterLift, {
          onNone: () => null,
          onSome: footerLift =>
            renderContent({}, [footerLift.footer], isActive),
        })}
      >
        {body}
      </KeyboardColumn>
    )
  } else {
    return body
  }
}

const styles = StyleSheet.create({
  fill: { flex: 1, minHeight: 0, minWidth: 0 },
  content: { flexGrow: 1 },
})

const hasSameScreens = <Message,>(
  current: StackNode<Message>,
  next: StackNode<Message>,
): boolean =>
  current.screens.length === next.screens.length &&
  current.screens.every(
    (screen, index) => screen.key === next.screens[index]?.key,
  )

/** Renders the Model's screens and reports native back actions as Messages. */
export const NativeStack = <Message,>({
  node: modelNode,
  dispatch,
  renderContent,
  isActive: isActiveProp,
}: Readonly<{
  node: StackNode<Message>
  dispatch: (message: Message) => void
  renderContent: RenderContent<Message>
  isActive: boolean
}>): React.ReactElement => {
  const isActive = useIsActive(isActiveProp)
  const isStackUpdateAllowed = React.useContext(StackUpdatesContext)
  const [node, setNode] = React.useState(modelNode)

  // NOTE: iOS can corrupt a hidden UINavigationController's header when its
  // stack changes in the tab-selection commit, so a hidden stack waits for the
  // tab's didAppear before screens are pushed or popped. Content changes that
  // keep the same screens, such as a theme change, apply at once; otherwise
  // the hidden tab shows stale content until it appears.
  if (
    node !== modelNode &&
    (isStackUpdateAllowed || hasSameScreens(node, modelNode))
  ) {
    setNode(modelNode)
  }

  const { onDismissed, isBackTitleVisible = true } = node.attributes
  const isStackActive = isActive && isStackUpdateAllowed
  const inheritedBackground = React.useContext(NavigationBackgroundContext)
  const stackBackground =
    node.attributes.style?.backgroundColor ?? inheritedBackground
  const hasBack = node.screens.length > 1 && onDismissed !== undefined
  const maybeTop = Array.last(node.screens)
  const requestDismissal = (dismissedCount: number): void => {
    if (isStackActive && hasBack && onDismissed !== undefined) {
      dispatch(onDismissed(dismissedCount))
    }
  }
  const handleHardwareBack = React.useEffectEvent(() => {
    requestDismissal(1)
  })

  React.useEffect(() => {
    if (!isStackActive || !hasBack) {
      return
    }

    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        handleHardwareBack()
        return true
      },
    )
    return () => subscription.remove()
  }, [isStackActive, hasBack])

  // NOTE: ScreenStackItem rejects decreasing activityState. All Model screens
  // stay active; ScreenStack determines their visibility from their order.
  return (
    <ScreenStack
      style={{
        flex: 1,
        ...node.attributes.style,
        backgroundColor: stackBackground,
      }}
    >
      {node.screens.map((screen, screenIndex) => {
        const attributes = collectNativeAttributes(screen.attributes)
        const backgroundColor =
          attributes.style?.backgroundColor ?? stackBackground
        const isTop =
          Option.isSome(maybeTop) && maybeTop.value.key === screen.key
        const reportDismissal = (
          event: Readonly<{ nativeEvent: Readonly<{ dismissCount: number }> }>,
        ) => requestDismissal(event.nativeEvent.dismissCount)

        return (
          <ScreenStackItem
            key={screen.key}
            screenId={screen.key}
            activityState={2}
            style={[StyleSheet.absoluteFill, { backgroundColor }]}
            contentStyle={{ ...styles.fill, backgroundColor }}
            stackAnimation={
              Platform.OS === 'android' ? 'slide_from_right' : 'default'
            }
            unstable_safeAreaEdges={{ bottom: true }}
            headerConfig={{
              title: attributes.title ?? screen.key,
              hidden: false,
              hideBackButton: screenIndex === 0 || !hasBack,
              ...(isBackTitleVisible ? {} : { backTitleVisible: false }),
            }}
            preventNativeDismiss={!isStackUpdateAllowed}
            nativeBackButtonDismissalEnabled={true}
            gestureEnabled={isStackUpdateAllowed && hasBack && isTop}
            onDismissed={isTop ? reportDismissal : undefined}
            onHeaderBackButtonClicked={
              isTop ? () => requestDismissal(1) : undefined
            }
          >
            <NavigationBackgroundContext.Provider value={backgroundColor}>
              <NavigationBody
                attributes={attributes}
                renderContent={renderContent}
                isActive={isStackActive && isTop}
                isStackScreen
              >
                {screen.children}
              </NavigationBody>
            </NavigationBackgroundContext.Provider>
          </ScreenStackItem>
        )
      })}
    </ScreenStack>
  )
}

const NativeTabBody = <Message,>({
  tab,
  attributes,
  dispatch,
  renderContent,
  isActive,
  backgroundColor,
}: Readonly<{
  tab: NativeTab<Message>
  attributes: NativeAttributes<Message>
  dispatch: (message: Message) => void
  renderContent: RenderContent<Message>
  isActive: boolean
  backgroundColor: string | undefined
}>): React.ReactElement => {
  const inheritedBackground = React.useContext(NavigationBackgroundContext)
  const tabBackground =
    attributes.style?.backgroundColor ?? backgroundColor ?? inheritedBackground
  const content = isNavigationContent(tab.children) ? (
    <NavigationBody
      attributes={attributes}
      renderContent={renderContent}
      isActive={isActive}
    >
      {tab.children}
    </NavigationBody>
  ) : (
    <NativeStack
      node={{ _tag: 'Stack', attributes: {}, screens: [tab] }}
      dispatch={dispatch}
      renderContent={renderContent}
      isActive={isActive}
    />
  )
  const surface = (
    <NavigationBackgroundContext.Provider value={tabBackground}>
      {content}
    </NavigationBackgroundContext.Provider>
  )

  if (Platform.OS === 'android') {
    return (
      <SafeAreaView
        edges={{ bottom: true }}
        insetType="interface"
        style={{ backgroundColor: tabBackground }}
      >
        {surface}
      </SafeAreaView>
    )
  } else {
    return surface
  }
}

type TabSelectedEvent = Readonly<{
  nativeEvent: Readonly<{
    selectedScreenKey: string
    provenance: number
    isRepeated: boolean
    actionOrigin:
      | 'user'
      | 'programmatic-js'
      | 'programmatic-native'
      | 'implicit'
  }>
}>

/** Tracks the native provenance the Model has seen for immediate selection.
 * A selection the Model did not request (a tap, or a platform change) records
 * its provenance. The next tabs node the view produces was built after update
 * handled that selection, because the runtime publishes no frame while
 * Messages wait, so its request is based on that provenance. Native then
 * rejects a request that a newer tap has made stale. */
const useImmediateSelectionBase = <Message,>(
  node: TabsNode<Message>,
): Readonly<{
  baseProvenance: number
  recordSelection: (provenance: number) => void
}> => {
  const latestSelectionProvenance = React.useRef(0)
  const seen = React.useRef({ node, provenance: 0 })

  // NOTE: the provenance belongs to the first render of each new node, the
  // frame built after update ran. Recording it is idempotent for one node, so
  // a render React discards leaves the same value for the committed render.
  if (seen.current.node !== node) {
    seen.current = { node, provenance: latestSelectionProvenance.current }
  }

  return {
    baseProvenance: seen.current.provenance,
    recordSelection: provenance => {
      latestSelectionProvenance.current = Math.max(
        latestSelectionProvenance.current,
        provenance,
      )
    },
  }
}

/** Uses the public native Tabs API with selection requests derived from the
 * Model. By default the tab bar waits for the Model; with
 * `ImmediateTabSelection(true)` it switches on tap and the Model follows. */
export const NativeTabs = <Message,>({
  node,
  dispatch,
  renderContent,
  isActive: isActiveProp,
}: Readonly<{
  node: TabsNode<Message>
  dispatch: (message: Message) => void
  renderContent: RenderContent<Message>
  isActive: boolean
}>): React.ReactElement => {
  const isActive = useIsActive(isActiveProp)
  const {
    selectedTab,
    onSelectTab,
    isTabSelectionImmediate = false,
  } = node.attributes
  const { baseProvenance, recordSelection } = useImmediateSelectionBase(node)
  const isParentStackUpdateAllowed = React.useContext(StackUpdatesContext)
  const [maybeVisibleTabKey, setMaybeVisibleTabKey] = React.useState<
    Option.Option<string>
  >(Option.none)
  const resolveAndroidTabIcon = useAndroidTabIcons(node.tabs)
  const maybeSelectedKey = Option.orElse(
    Option.fromNullishOr(selectedTab),
    () => Option.map(Array.head(node.tabs), tab => tab.key),
  )
  const requestedKey = Option.getOrElse(maybeSelectedKey, () => '')
  const requestBase = isTabSelectionImmediate ? baseProvenance : 0
  const navStateRequest = React.useMemo(
    () => ({ selectedScreenKey: requestedKey, baseProvenance: requestBase }),
    [requestedKey, requestBase],
  )
  const handleTabSelected = (event: TabSelectedEvent): void => {
    const { selectedScreenKey, provenance, isRepeated, actionOrigin } =
      event.nativeEvent
    if (actionOrigin === 'programmatic-js') {
      return
    }

    if (isTabSelectionImmediate) {
      recordSelection(provenance)
      // NOTE: the tab bar has already switched, so update hears every new
      // selection, including a return to the tab the Model still selects
      // while an earlier tap is on its way.
      if (!isRepeated && onSelectTab !== undefined) {
        dispatch(onSelectTab(selectedScreenKey))
      }
    } else if (
      isActive &&
      selectedScreenKey !== requestedKey &&
      onSelectTab !== undefined
    ) {
      dispatch(onSelectTab(selectedScreenKey))
    }
  }

  return Option.match(maybeSelectedKey, {
    onNone: () => <View />,
    onSome: selectedKey => (
      <View style={{ flex: 1, ...node.attributes.style }}>
        <Tabs.Host
          navStateRequest={navStateRequest}
          rejectStaleNavStateUpdates={isTabSelectionImmediate}
          onTabSelected={handleTabSelected}
          onTabSelectionPrevented={event => {
            if (isActive && onSelectTab !== undefined) {
              dispatch(onSelectTab(event.nativeEvent.preventedScreenKey))
            }
          }}
        >
          {node.tabs.map(tab => {
            const attributes = collectNativeAttributes(tab.attributes)
            return (
              <Tabs.Screen
                key={tab.key}
                screenKey={tab.key}
                title={attributes.title ?? tab.key}
                onDidAppear={
                  Platform.OS === 'ios'
                    ? () => setMaybeVisibleTabKey(Option.some(tab.key))
                    : undefined
                }
                onWillDisappear={
                  Platform.OS === 'ios'
                    ? () =>
                        setMaybeVisibleTabKey(maybeVisibleKey =>
                          Option.filter(
                            maybeVisibleKey,
                            key => key !== tab.key,
                          ),
                        )
                    : undefined
                }
                android={resolveAndroidTabIcon(attributes.tabIcon)}
                ios={{
                  overrideScrollViewContentInsetAdjustmentBehavior: false,
                  ...(attributes.tabIcon === undefined
                    ? {}
                    : {
                        icon: {
                          type: 'sfSymbol',
                          name: attributes.tabIcon.sfSymbol,
                        },
                        selectedIcon: {
                          type: 'sfSymbol',
                          name:
                            attributes.tabIcon.selectedSfSymbol ??
                            attributes.tabIcon.sfSymbol,
                        },
                      }),
                }}
                preventNativeSelection={!isTabSelectionImmediate}
                specialEffects={{
                  repeatedTabSelection: {
                    popToRoot: false,
                    scrollToTop: false,
                  },
                }}
              >
                <StackUpdatesContext.Provider
                  value={
                    isParentStackUpdateAllowed &&
                    (Platform.OS !== 'ios' ||
                      (isActive &&
                        tab.key === selectedKey &&
                        Option.contains(maybeVisibleTabKey, tab.key)))
                  }
                >
                  <NativeTabBody
                    tab={tab}
                    attributes={attributes}
                    backgroundColor={node.attributes.style?.backgroundColor}
                    dispatch={dispatch}
                    renderContent={renderContent}
                    isActive={isActive && tab.key === selectedKey}
                  />
                </StackUpdatesContext.Provider>
              </Tabs.Screen>
            )
          })}
        </Tabs.Host>
      </View>
    ),
  })
}
