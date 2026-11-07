import { Array } from 'effect'
import type { StrictHtmlBuilder } from 'foldkit/strict'

import type {
  NativeAttribute,
  NativeChild,
  NativeNode,
  NativeTag,
} from './node'
import { makeLazyNode } from './stickyFooter'

/** A strict builder with an additional native key attribute. */
export type NativeBuilder<Message> = StrictHtmlBuilder<
  Message,
  NativeNode<Message>,
  NativeAttribute<Message>
> &
  Readonly<{
    Key: (key: string) => NativeAttribute<Message>
  }>

/** Merges portable styles and simultaneous gestures in attribute order. @internal */
export const collectNativeAttributes = <Message>(
  attributes: ReadonlyArray<NativeAttribute<Message>>,
): NativeAttribute<Message> =>
  attributes.reduce<NativeAttribute<Message>>(
    (collected, attribute) => ({
      ...collected,
      ...attribute,
      ...(attribute.style && {
        style: { ...collected.style, ...attribute.style },
      }),
      ...(attribute.animatedStyles && {
        animatedStyles: [
          ...(collected.animatedStyles ?? []),
          ...attribute.animatedStyles,
        ],
      }),
      ...(attribute.gestures && {
        gestures: [...(collected.gestures ?? []), ...attribute.gestures],
      }),
    }),
    {},
  )

type LazyEntry<Message> = Readonly<{
  view: Function
  args: ReadonlyArray<unknown>
  node: NativeNode<Message>
}>

const isEveryArgumentEqual = (
  previous: ReadonlyArray<unknown>,
  current: ReadonlyArray<unknown>,
): boolean =>
  previous.length === current.length &&
  previous.every((argument, index) => argument === current[index])

/** Creates a portable builder whose elements contain data and event mappers. */
export const makeNativeBuilder = <Message>(): NativeBuilder<Message> => {
  const lazySlots = new WeakMap<
    object,
    Map<PropertyKey | undefined, LazyEntry<Message>>
  >()
  const buildElement = (
    tag: NativeTag,
    attributes: ReadonlyArray<NativeAttribute<Message>>,
    children: ReadonlyArray<NativeChild<Message>> = [],
    key?: string,
  ): NativeNode<Message> => {
    const collected = collectNativeAttributes(attributes)
    const { key: attributeKey, ...elementAttributes } = collected

    return {
      _tag: 'Element',
      tag,
      key: key ?? attributeKey,
      attributes: elementAttributes,
      children,
    }
  }
  const element =
    (tag: NativeTag) =>
    (
      attributes: ReadonlyArray<NativeAttribute<Message>>,
      children?: ReadonlyArray<NativeChild<Message>>,
    ) =>
      buildElement(tag, attributes, children)

  return {
    div: element('div'),
    span: element('span'),
    p: element('p'),
    h1: element('h1'),
    h2: element('h2'),
    h3: element('h3'),
    label: element('label'),
    button: element('button'),
    input: element('input'),
    textarea: element('textarea'),
    img: element('img'),
    ul: element('ul'),
    li: element('li'),
    footer: element('footer'),
    stickyFooter: (attributes, children) =>
      buildElement(
        'footer',
        [...attributes, { isStickyFooter: true }],
        children,
      ),
    keyed:
      (tag: NativeTag) =>
      (
        key: string,
        attributes: ReadonlyArray<NativeAttribute<Message>>,
        children?: ReadonlyArray<NativeChild<Message>>,
      ): NativeNode<Message> =>
        buildElement(tag, attributes, children, key),
    list: (
      attributes,
      { items, key, view, itemHeight, maintainVisibleContentPosition },
    ) => {
      const collected = collectNativeAttributes(attributes)
      const { key: attributeKey, ...listAttributes } = collected

      return {
        _tag: 'List',
        key: attributeKey,
        attributes: listAttributes,
        rows: Array.map(items, (item, index) => ({
          key: key(item),
          render: () => view(item, index),
        })),
        ...(itemHeight === undefined ? {} : { itemHeight }),
        ...(maintainVisibleContentPosition === undefined
          ? {}
          : { maintainVisibleContentPosition }),
      }
    },
    stack: (attributes, screens) => ({
      _tag: 'Stack',
      attributes: collectNativeAttributes(attributes),
      screens,
    }),
    screen: (key, attributes, children = []) => ({ key, attributes, children }),
    tabs: (attributes, tabs) => ({
      _tag: 'Tabs',
      attributes: collectNativeAttributes(attributes),
      tabs,
    }),
    tab: (key, attributes, children = []) => ({ key, attributes, children }),
    OnTransitionEnd: onTransitionEnd => ({ onTransitionEnd }),
    Entering: entering => ({ entering }),
    Exiting: exiting => ({ exiting }),
    AnimatedStyle: (key, mapper) => ({ animatedStyles: [{ key, mapper }] }),
    Title: title => ({ title }),
    TabIcon: tabIcon => ({ tabIcon }),
    OnDismissed: onDismissed => ({ onDismissed }),
    BackTitleVisible: isBackTitleVisible => ({ isBackTitleVisible }),
    SelectedTab: selectedTab => ({ selectedTab }),
    OnSelectTab: onSelectTab => ({ onSelectTab }),
    ImmediateTabSelection: isTabSelectionImmediate => ({
      isTabSelectionImmediate,
    }),
    Gesture: gesture => ({ gestures: [gesture] }),
    empty: { _tag: 'Empty' },
    lazy: (slot, key, view, args) => {
      const entries =
        lazySlots.get(slot) ??
        new Map<PropertyKey | undefined, LazyEntry<Message>>()
      lazySlots.set(slot, entries)
      const entry = entries.get(key)

      if (
        entry !== undefined &&
        entry.view === view &&
        isEveryArgumentEqual(entry.args, args)
      ) {
        return entry.node
      }

      const node = makeLazyNode(view(...args))
      entries.set(key, { view, args, node })
      return node
    },
    Style: style => ({ style }),
    OnClick: message => ({ onClick: message }),
    OnInput: toMessage => ({ onInput: toMessage }),
    OnSubmitEditing: message => ({ onSubmitEditing: message }),
    OnEndReached: message => ({ onEndReached: message }),
    Value: value => ({ value }),
    Rows: rows => ({ rows }),
    Placeholder: placeholder => ({ placeholder }),
    Src: src => ({ src }),
    Alt: alt => ({ alt }),
    Key: key => ({ key }),
    AriaLabel: ariaLabel => ({ ariaLabel }),
    Disabled: isDisabled => ({ isDisabled }),
    Checked: isChecked => ({ isChecked }),
  }
}
