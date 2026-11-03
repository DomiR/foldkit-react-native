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
  gestures?: ReadonlyArray<StrictGesture<Message>>
  animatedStyles?: ReadonlyArray<AnimatedStyleBinding>
  entering?: StrictLayoutAnimation
  exiting?: StrictLayoutAnimation
  onTransitionEnd?: Message
  style?: NativeStyle
  onClick?: Message
  onInput?: (value: string) => Message
  onSubmitEditing?: Message
  value?: string
  placeholder?: string
  src?: string
  alt?: string
  ariaLabel?: string
  isDisabled?: boolean
  isChecked?: boolean
}>

/** An attribute supplied to a native element builder. */
export type NativeAttribute<Message> = NativeAttributes<Message> &
  Readonly<{ key?: string }>

/** A native element or an explicitly empty view. */
export type NativeNode<Message> =
  | Readonly<{
      _tag: 'Element'
      tag: NativeTag
      inputRevision?: number
      key: string | undefined
      attributes: NativeAttributes<Message>
      children: ReadonlyArray<NativeChild<Message>>
    }>
  | Readonly<{
      _tag: 'Stack'
      attributes: NativeAttributes<Message>
      screens: ReadonlyArray<NativeScreen<Message>>
    }>
  | Readonly<{
      _tag: 'Tabs'
      attributes: NativeAttributes<Message>
      tabs: ReadonlyArray<NativeTab<Message>>
    }>
  | Readonly<{ _tag: 'Empty' }>

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
