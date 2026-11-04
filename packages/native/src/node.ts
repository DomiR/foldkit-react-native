import type { Option } from 'effect'
import type {
  StrictGesture,
  StrictIcon,
  AnimatedStyleBinding,
  StrictLayoutAnimation,
  StrictScreen,
  StrictStyle,
  StrictTab,
  StrictTag,
} from 'foldkit/strict'

/** The element names supported by the native renderer. */
export type NativeTag = StrictTag

/** Portable styles passed to native layout and text elements. */
export type NativeStyle = StrictStyle

/** Collected element attributes and event mappers. */
export type NativeAttributes<Message> = Readonly<{
  title?: string
  tabIcon?: StrictIcon
  onDismissed?: (dismissedCount: number) => Message
  selectedTab?: string
  onSelectTab?: (key: string) => Message
  isTabSelectionImmediate?: boolean
  gestures?: ReadonlyArray<StrictGesture<Message>>
  animatedStyles?: ReadonlyArray<AnimatedStyleBinding>
  entering?: StrictLayoutAnimation
  exiting?: StrictLayoutAnimation
  onTransitionEnd?: Message
  style?: NativeStyle
  onClick?: Message
  onInput?: (value: string) => Message
  onSubmitEditing?: Message
  rows?: number;
  onEndReached?: Message
  value?: string
  placeholder?: string
  src?: string
  alt?: string
  ariaLabel?: string
  isDisabled?: boolean
  isChecked?: boolean
  isStickyFooter?: boolean
}>

/** An attribute supplied to a native element builder. */
export type NativeAttribute<Message> = NativeAttributes<Message> &
  Readonly<{ key?: string }>

type NativeNodeIdentity = {
  /** The framework-managed view identity stamped by the build transform. Application code does not set this field. */
  identity?: string
}

/** A keyed row whose view is built when the native list renders it. */
export type NativeListRow<Message> = Readonly<{
  key: string
  render: () => NativeNode<Message>
}>

/** A native element or an explicitly empty view. */
export type NativeNode<Message> =
  | (Readonly<{
      _tag: 'Element'
      tag: NativeTag
      key: string | undefined
      attributes: NativeAttributes<Message>
      children: ReadonlyArray<NativeChild<Message>>
    }> &
      NativeNodeIdentity)
  | (Readonly<{
      _tag: 'List'
      key: string | undefined
      attributes: NativeAttributes<Message>
      rows: ReadonlyArray<NativeListRow<Message>>
      itemHeight?: number
      maintainVisibleContentPosition?: boolean
    }> &
      NativeNodeIdentity)
  | (Readonly<{
      _tag: 'Stack'
      attributes: NativeAttributes<Message>
      screens: ReadonlyArray<NativeScreen<Message>>
    }> &
      NativeNodeIdentity)
  | (Readonly<{
      _tag: 'Tabs'
      attributes: NativeAttributes<Message>
      tabs: ReadonlyArray<NativeTab<Message>>
    }> &
      NativeNodeIdentity)
  | Readonly<{
      /** A node reused by `createStrictLazy` while its inputs are unchanged.
       * The renderer skips the subtree while the same Lazy node is rendered. */
      _tag: 'Lazy'
      node: NativeNode<Message>
      /** The node's first sticky footer and the rest of the node, computed
       * once so a lifted footer and body keep stable references. */
      liftStickyFooter: () => Option.Option<NativeFooterLift<Message>>
    }>
  | Readonly<{ _tag: 'Empty' }>

/** A sticky footer lifted out of a screen body, and the body without it. */
export type NativeFooterLift<Message> = Readonly<{
  footer: NativeNode<Message>
  children: ReadonlyArray<NativeChild<Message>>
}>

/** An element, text, or an omitted child. */
export type NativeChild<Message> = NativeNode<Message> | string | null

/** A keyed native stack screen description. */
export type NativeScreen<Message> = StrictScreen<
  NativeNode<Message>,
  NativeAttribute<Message>
>

/** A keyed native tab description. */
export type NativeTab<Message> = StrictTab<
  NativeNode<Message>,
  NativeAttribute<Message>
>
