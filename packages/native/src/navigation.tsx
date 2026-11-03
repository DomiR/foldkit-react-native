import { Array, Option, Predicate } from 'effect'
import * as React from 'react'
import {
  BackHandler,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native'
import { ScreenStack, ScreenStackItem, Tabs } from 'react-native-screens'
import { SafeAreaView } from 'react-native-screens/experimental'

import { collectNativeAttributes } from './builder'
import type {
  NativeAttributes,
  NativeChild,
  NativeNode,
  NativeTab,
} from './node'
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
      (child._tag === 'Stack' || child._tag === 'Tabs'),
  )

const NavigationBackgroundContext = React.createContext('#ffffff')

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

  // NOTE: RN keyboard adjustment clamps against contentInset, excluding automatic
  // header insets. Stack screens apply safe-area spacing outside the ScrollView.
  return (
    <ScrollView
      style={styles.fill}
      contentContainerStyle={styles.content}
      removeClippedSubviews={false}
      automaticallyAdjustKeyboardInsets
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      contentInsetAdjustmentBehavior={isStackScreen ? 'never' : 'automatic'}
      automaticallyAdjustsScrollIndicatorInsets
    >
      {renderContent({ ...attributes, style }, children, isActive)}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1, minHeight: 0, minWidth: 0 },
  content: { flexGrow: 1 },
})

/** Renders the Model's screens and reports native back actions as Messages. */
export const NativeStack = <Message,>({
  node,
  dispatch,
  renderContent,
  isActive,
}: Readonly<{
  node: StackNode<Message>
  dispatch: (message: Message) => void
  renderContent: RenderContent<Message>
  isActive: boolean
}>): React.ReactElement => {
  const { onDismissed } = node.attributes
  const inheritedBackground = React.useContext(NavigationBackgroundContext)
  const stackBackground =
    node.attributes.style?.backgroundColor ?? inheritedBackground
  const hasBack = node.screens.length > 1 && onDismissed !== undefined
  const maybeTop = Array.last(node.screens)
  const requestDismissal = (dismissedCount: number): void => {
    if (isActive && hasBack && onDismissed !== undefined) {
      dispatch(onDismissed(dismissedCount))
    }
  }
  const handleHardwareBack = React.useEffectEvent(() => {
    requestDismissal(1)
  })

  React.useEffect(() => {
    if (!isActive || !hasBack) {
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
  }, [isActive, hasBack])

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
            }}
            preventNativeDismiss={false}
            nativeBackButtonDismissalEnabled={true}
            gestureEnabled={hasBack && isTop}
            onDismissed={isTop ? reportDismissal : undefined}
            onHeaderBackButtonClicked={
              isTop ? () => requestDismissal(1) : undefined
            }
          >
            <NavigationBackgroundContext.Provider value={backgroundColor}>
              <NavigationBody
                attributes={attributes}
                renderContent={renderContent}
                isActive={isActive && isTop}
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

/** Uses the public native Tabs API with selection requests derived from the Model. */
export const NativeTabs = <Message,>({
  node,
  dispatch,
  renderContent,
  isActive,
}: Readonly<{
  node: TabsNode<Message>
  dispatch: (message: Message) => void
  renderContent: RenderContent<Message>
  isActive: boolean
}>): React.ReactElement => {
  const { selectedTab, onSelectTab } = node.attributes
  const resolveAndroidTabIcon = useAndroidTabIcons(node.tabs)
  const maybeSelectedKey = Option.orElse(
    Option.fromNullishOr(selectedTab),
    () => Option.map(Array.head(node.tabs), tab => tab.key),
  )

  return Option.match(maybeSelectedKey, {
    onNone: () => <View />,
    onSome: selectedKey => (
      <View style={{ flex: 1, ...node.attributes.style }}>
        <Tabs.Host
          navStateRequest={{
            selectedScreenKey: selectedKey,
            baseProvenance: 0,
          }}
          rejectStaleNavStateUpdates={false}
          onTabSelected={event => {
            const { selectedScreenKey, actionOrigin } = event.nativeEvent
            if (
              isActive &&
              actionOrigin !== 'programmatic-js' &&
              selectedScreenKey !== selectedKey &&
              onSelectTab !== undefined
            ) {
              dispatch(onSelectTab(selectedScreenKey))
            }
          }}
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
                preventNativeSelection={true}
                specialEffects={{
                  repeatedTabSelection: {
                    popToRoot: false,
                    scrollToTop: false,
                  },
                }}
              >
                <NativeTabBody
                  tab={tab}
                  attributes={attributes}
                  backgroundColor={node.attributes.style?.backgroundColor}
                  dispatch={dispatch}
                  renderContent={renderContent}
                  isActive={isActive && tab.key === selectedKey}
                />
              </Tabs.Screen>
            )
          })}
        </Tabs.Host>
      </View>
    ),
  })
}
