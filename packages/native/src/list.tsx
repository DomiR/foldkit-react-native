import * as React from 'react'
import { FlatList } from 'react-native'
import type { ViewStyle } from 'react-native'

import type { NativeListRow, NativeNode } from './node'

const ON_END_REACHED_THRESHOLD = 0.5
const INITIAL_NUM_TO_RENDER = 12

type ListNode<Message> = Extract<
  NativeNode<Message>,
  Readonly<{ _tag: 'List' }>
>

/** Supplies the navigation body's inset policy to its scrolling list. @internal */
export const ListScrollContext = React.createContext<
  Readonly<{
    contentInsetAdjustmentBehavior: 'automatic' | 'never'
    automaticallyAdjustKeyboardInsets: boolean
  }>
>({
  contentInsetAdjustmentBehavior: 'automatic',
  automaticallyAdjustKeyboardInsets: true,
})

/** Virtualizes keyed rows and reports active end-of-list events as Messages. @internal */
export const NativeList = <Message,>({
  node,
  layout,
  dispatch,
  renderRow,
  isActive,
}: Readonly<{
  node: ListNode<Message>
  layout: ViewStyle
  dispatch: (message: Message) => void
  renderRow: (node: NativeNode<Message>) => React.ReactElement | null
  isActive: boolean
}>): React.ReactElement => {
  const { attributes, rows, itemHeight, maintainVisibleContentPosition } = node
  const { ariaLabel, onEndReached } = attributes
  const { contentInsetAdjustmentBehavior, automaticallyAdjustKeyboardInsets } =
    React.useContext(ListScrollContext)

  // NOTE: Rows and extraData change each frame so memoized cells receive
  // row thunks that close over the latest Model.
  return (
    <FlatList<NativeListRow<Message>>
      data={rows}
      keyExtractor={row => row.key}
      renderItem={({ item }) => renderRow(item.render())}
      extraData={rows}
      getItemLayout={
        itemHeight === undefined
          ? undefined
          : (_, index) => ({
              length: itemHeight,
              offset: itemHeight * index,
              index,
            })
      }
      maintainVisibleContentPosition={
        maintainVisibleContentPosition ? { minIndexForVisible: 0 } : undefined
      }
      onEndReached={() => {
        if (isActive && onEndReached !== undefined) {
          dispatch(onEndReached)
        }
      }}
      onEndReachedThreshold={ON_END_REACHED_THRESHOLD}
      initialNumToRender={INITIAL_NUM_TO_RENDER}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      automaticallyAdjustKeyboardInsets={automaticallyAdjustKeyboardInsets}
      automaticallyAdjustsScrollIndicatorInsets
      contentInsetAdjustmentBehavior={contentInsetAdjustmentBehavior}
      accessibilityLabel={ariaLabel}
      style={{ flex: 1, minHeight: 0, ...layout }}
    />
  )
}
