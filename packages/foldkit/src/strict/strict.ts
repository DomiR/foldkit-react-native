import { Schema } from 'effect'

import type {
  AnimatedStyleBinding,
  AnimatedValueKey,
  StrictLayoutAnimation,
} from './animation.js'
import type { StrictGesture } from './gesture.js'
import type { StrictIcon } from './icon.js'

/** Portable transforms applied in array order. Angles include their unit. @experimental */
export const StrictTransform = Schema.Union([
  Schema.Struct({ translateX: Schema.Number }),
  Schema.Struct({ translateY: Schema.Number }),
  Schema.Struct({ scale: Schema.Number }),
  Schema.Struct({
    rotate: Schema.Union([
      Schema.TemplateLiteral([Schema.Number, 'deg']),
      Schema.TemplateLiteral([Schema.Number, 'rad']),
    ]),
  }),
])

/** A portable transform operation. @experimental */
export type StrictTransform = typeof StrictTransform.Type

/** Properties accepted by strict CSS transitions. @experimental */
export const TransitionProperty = Schema.Literals([
  'all',
  'width',
  'height',
  'minWidth',
  'minHeight',
  'maxWidth',
  'maxHeight',
  'padding',
  'margin',
  'top',
  'right',
  'bottom',
  'left',
  'gap',
  'backgroundColor',
  'color',
  'opacity',
  'borderWidth',
  'borderColor',
  'borderRadius',
  'fontSize',
  'lineHeight',
  'letterSpacing',
  'transform',
])

const Dimension = Schema.Union([
  Schema.Number,
  Schema.TemplateLiteral([Schema.Number, '%']),
  Schema.Literal('auto'),
])
const Spacing = Schema.Union([
  Schema.Number,
  Schema.TemplateLiteral([Schema.Number, '%']),
])

/** Portable styles with React Native layout semantics. Numeric lengths use
 * density-independent pixels, rendered as CSS pixels on the web.
 * @experimental The portable style subset may change between releases. */
export const StrictStyle = Schema.Struct({
  transitionProperty: Schema.optionalKey(
    Schema.Union([
      TransitionProperty,
      Schema.Literal('none'),
      Schema.Array(TransitionProperty),
    ]),
  ),
  transitionDuration: Schema.optionalKey(Schema.Number),
  transitionDelay: Schema.optionalKey(Schema.Number),
  transitionTimingFunction: Schema.optionalKey(
    Schema.Literals(['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out']),
  ),
  transform: Schema.optionalKey(Schema.Array(StrictTransform)),
  flex: Schema.optionalKey(Schema.Number),
  flexDirection: Schema.optionalKey(
    Schema.Literals(['row', 'column', 'row-reverse', 'column-reverse']),
  ),
  flexWrap: Schema.optionalKey(
    Schema.Literals(['nowrap', 'wrap', 'wrap-reverse']),
  ),
  alignItems: Schema.optionalKey(
    Schema.Literals([
      'stretch',
      'flex-start',
      'flex-end',
      'center',
      'baseline',
    ]),
  ),
  alignSelf: Schema.optionalKey(
    Schema.Literals([
      'auto',
      'stretch',
      'flex-start',
      'flex-end',
      'center',
      'baseline',
    ]),
  ),
  justifyContent: Schema.optionalKey(
    Schema.Literals([
      'flex-start',
      'flex-end',
      'center',
      'space-between',
      'space-around',
      'space-evenly',
    ]),
  ),
  gap: Schema.optionalKey(Schema.Number),
  rowGap: Schema.optionalKey(Schema.Number),
  columnGap: Schema.optionalKey(Schema.Number),
  width: Schema.optionalKey(Dimension),
  height: Schema.optionalKey(Dimension),
  minWidth: Schema.optionalKey(Dimension),
  minHeight: Schema.optionalKey(Dimension),
  maxWidth: Schema.optionalKey(Dimension),
  maxHeight: Schema.optionalKey(Dimension),
  padding: Schema.optionalKey(Spacing),
  paddingHorizontal: Schema.optionalKey(Spacing),
  paddingVertical: Schema.optionalKey(Spacing),
  paddingTop: Schema.optionalKey(Spacing),
  paddingRight: Schema.optionalKey(Spacing),
  paddingBottom: Schema.optionalKey(Spacing),
  paddingLeft: Schema.optionalKey(Spacing),
  margin: Schema.optionalKey(Dimension),
  marginHorizontal: Schema.optionalKey(Dimension),
  marginVertical: Schema.optionalKey(Dimension),
  marginTop: Schema.optionalKey(Dimension),
  marginRight: Schema.optionalKey(Dimension),
  marginBottom: Schema.optionalKey(Dimension),
  marginLeft: Schema.optionalKey(Dimension),
  position: Schema.optionalKey(Schema.Literals(['relative', 'absolute'])),
  top: Schema.optionalKey(Dimension),
  right: Schema.optionalKey(Dimension),
  bottom: Schema.optionalKey(Dimension),
  left: Schema.optionalKey(Dimension),
  zIndex: Schema.optionalKey(Schema.Number),
  overflow: Schema.optionalKey(Schema.Literals(['visible', 'hidden'])),
  backgroundColor: Schema.optionalKey(Schema.String),
  color: Schema.optionalKey(Schema.String),
  opacity: Schema.optionalKey(Schema.Number),
  borderWidth: Schema.optionalKey(Schema.Number),
  borderColor: Schema.optionalKey(Schema.String),
  borderRadius: Schema.optionalKey(Schema.Number),
  borderStyle: Schema.optionalKey(
    Schema.Literals(['solid', 'dotted', 'dashed']),
  ),
  fontSize: Schema.optionalKey(Schema.Number),
  fontWeight: Schema.optionalKey(
    Schema.Literals([
      'normal',
      'bold',
      '100',
      '200',
      '300',
      '400',
      '500',
      '600',
      '700',
      '800',
      '900',
      100,
      200,
      300,
      400,
      500,
      600,
      700,
      800,
      900,
    ]),
  ),
  fontStyle: Schema.optionalKey(Schema.Literals(['normal', 'italic'])),
  lineHeight: Schema.optionalKey(Schema.Number),
  letterSpacing: Schema.optionalKey(Schema.Number),
  /** Android only. `false` removes the extra top and bottom padding Android
   * adds to text for ascenders and descenders, so text lines up with its
   * `lineHeight`. iOS and the web ignore it. */
  includeFontPadding: Schema.optionalKey(Schema.Boolean),
  textAlign: Schema.optionalKey(
    Schema.Literals(['auto', 'left', 'right', 'center', 'justify']),
  ),
  textDecorationLine: Schema.optionalKey(
    Schema.Literals([
      'none',
      'underline',
      'line-through',
      'underline line-through',
    ]),
  ),
})

/** A readonly portable style record. @experimental */
export type StrictStyle = typeof StrictStyle.Type

/** Element names shared by strict web and native renderers. @experimental */
export const StrictTag = Schema.Literals([
  'div',
  'span',
  'p',
  'h1',
  'h2',
  'h3',
  'label',
  'button',
  'input',
  'textarea',
  'img',
  'ul',
  'li',
  'footer',
])

/** An element name supported by both hosts. @experimental */
export type StrictTag = typeof StrictTag.Type

type ElementBuilder<Node, Attribute> = (
  attributes: ReadonlyArray<Attribute>,
  children?: ReadonlyArray<Node | string | null>,
) => Node

/** A keyed screen description owned by a strict stack. @experimental */
export type StrictScreen<Node, Attribute> = Readonly<{
  key: string
  attributes: ReadonlyArray<Attribute>
  children: ReadonlyArray<Node | string | null>
}>

/** A keyed tab description owned by a strict tab container. @experimental */
export type StrictTab<Node, Attribute> = StrictScreen<Node, Attribute>

/** A homogeneous collection keyed by stable Model identifiers. Lists and text
 * inputs inside rows, Gesture on the list, and Entering or Exiting on rows are
 * unsupported. @experimental */
export type StrictList<Item, Node> = Readonly<{
  items: ReadonlyArray<Item>
  key: (item: Item) => string
  view: (item: Item, index: number) => Node
  itemHeight?: number
  /** Preserves the visible content position when items change. The web uses
   * browser scroll anchoring and ignores this option. */
  maintainVisibleContentPosition?: boolean
}>

/** A host-neutral subset of HtmlBuilder. `Checked` selects a boolean input;
 * `OnClick` records its toggle. `OnSubmitEditing` records Enter on a text input.
 * On a textarea, Enter inserts a newline and `OnSubmitEditing` is ignored.
 * Textarea content comes from `Value`, not children.
 * @experimental The strict builder contract may change between releases. */
export type StrictHtmlBuilder<Message, Node, Attribute> = Readonly<
  Record<Exclude<StrictTag, 'textarea'>, ElementBuilder<Node, Attribute>> &
    Readonly<{ textarea: (attributes: ReadonlyArray<Attribute>) => Node }>
> &
  Readonly<{
    /** A screen or tab lifts the first stickyFooter in its element tree out of
     * the scrolling body, renders it below the body, and keeps it above the
     * software keyboard. Use at most one per screen. Outside a screen or tab
     * it renders as a footer element. On native, only screen and tab bodies
     * move out of the way of the software keyboard. */
    stickyFooter: (
      attributes: ReadonlyArray<Attribute>,
      children?: ReadonlyArray<Node | string | null>,
    ) => Node
    keyed: <Tag extends StrictTag>(
      tag: Tag,
    ) => Tag extends 'textarea'
      ? (key: string, attributes: ReadonlyArray<Attribute>) => Node
      : (
          key: string,
          attributes: ReadonlyArray<Attribute>,
          children?: ReadonlyArray<Node | string | null>,
        ) => Node
    /** Renders a long homogeneous keyed collection. `key` must return a stable
     * Model id, never the index. Hosts may call `view` lazily for visible rows.
     * `itemHeight` declares a fixed row height in density-independent pixels.
     * Native uses it for row layout; the web uses it to skip layout of
     * off-screen rows.
     *
     * A screen or tab body containing a list anywhere in its element tree fills
     * the screen without scrolling; the list scrolls itself. Elements between
     * the body and the list need `Style({ flex: 1, minHeight: 0 })`.
     * @experimental */
    list: <Item>(
      attributes: ReadonlyArray<Attribute>,
      list: StrictList<Item, Node>,
    ) => Node
    stack: (
      attributes: ReadonlyArray<Attribute>,
      screens: ReadonlyArray<StrictScreen<Node, Attribute>>,
    ) => Node
    screen: (
      key: string,
      attributes: ReadonlyArray<Attribute>,
      children?: ReadonlyArray<Node | string | null>,
    ) => StrictScreen<Node, Attribute>
    tabs: (
      attributes: ReadonlyArray<Attribute>,
      tabs: ReadonlyArray<StrictTab<Node, Attribute>>,
    ) => Node
    tab: (
      key: string,
      attributes: ReadonlyArray<Attribute>,
      children?: ReadonlyArray<Node | string | null>,
    ) => StrictTab<Node, Attribute>
    Title: (title: string) => Attribute
    /** Attaches a `StrictIcon` to a tab. Each host renders the field it
     * supports and ignores the others. A tab without `TabIcon` shows its title
     * alone. */
    TabIcon: (icon: StrictIcon) => Attribute
    OnDismissed: (toMessage: (dismissedCount: number) => Message) => Attribute
    SelectedTab: (key: string) => Attribute
    OnSelectTab: (toMessage: (key: string) => Message) => Attribute
    /** On native tabs, `true` lets the tab bar switch as soon as the user taps
     * a tab, before update runs, and reports the tap through `OnSelectTab`.
     * Update must then select the reported tab: a Model that keeps another
     * `SelectedTab` leaves the tab bar on the tapped tab until its
     * `SelectedTab` changes again. Taps that arrive while an older Model
     * selection is on its way win over that selection. Without it, or with
     * `false`, a tap only reports `OnSelectTab` and the tab bar follows the
     * Model, so update can reject a tab. The web ignores it. */
    ImmediateTabSelection: (isImmediate: boolean) => Attribute
    Gesture: (gesture: StrictGesture<Message>) => Attribute
    OnTransitionEnd: (message: Message) => Attribute
    Entering: (animation: StrictLayoutAnimation) => Attribute
    Exiting: (animation: StrictLayoutAnimation) => Attribute
    AnimatedStyle: (
      key: AnimatedValueKey,
      mapper: AnimatedStyleBinding['mapper'],
    ) => Attribute
    empty: Node
    /** Host hook behind `createStrictLazy` and `createStrictKeyedLazy`. Returns
     * the node cached under `slot` and `key` when `view` and every argument are
     * equal by reference to the previous call; otherwise calls `view` with
     * `args` and caches the result. Hosts may skip rendering a reused node.
     * Application code uses `createStrictLazy` instead. */
    lazy: <Args extends ReadonlyArray<unknown>>(
      slot: object,
      key: PropertyKey | undefined,
      view: (...args: Args) => Node,
      args: Args,
    ) => Node
    Style: (style: StrictStyle) => Attribute
    OnClick: (message: Message) => Attribute
    /** Records that the user scrolled near the end of a list. It may fire more
     * than once, so update must guard repeated Messages, for example by ignoring
     * them while a page is loading. @experimental */
    OnEndReached: (message: Message) => Attribute
    OnInput: (toMessage: (value: string) => Message) => Attribute
    OnSubmitEditing: (message: Message) => Attribute
    Value: (value: string) => Attribute
    Rows: (rows: number) => Attribute
    Placeholder: (value: string) => Attribute
    Src: (value: string) => Attribute
    Alt: (value: string) => Attribute
    AriaLabel: (value: string) => Attribute
    Disabled: (value: boolean) => Attribute
    Checked: (value: boolean) => Attribute
  }>

/** One view that can render through any strict builder without host imports.
 * @experimental The strict view contract may change between releases. */
export type StrictView<Model, Message> = <Node, Attribute>(
  model: Model,
  h: StrictHtmlBuilder<Message, Node, Attribute>,
) => Node
