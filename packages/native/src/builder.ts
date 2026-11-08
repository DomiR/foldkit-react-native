import { Array } from 'effect'
import type { BlockScope, BlockScopes } from 'foldkit/runtime-core'
import { type StrictHtmlBuilder, mapMessages } from 'foldkit/strict'

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

const withBlocks = <Message>(
  h: Omit<NativeBuilder<Message>, 'block'>,
  readBlockScopes: () => BlockScopes | undefined,
  maybeScope: BlockScope | undefined,
): NativeBuilder<Message> => {
  const childBuilders = new WeakMap<BlockScope, NativeBuilder<unknown>>()
  const builder: NativeBuilder<Message> = {
    ...h,
    block: (binding, model, view, options) => {
      const blockScopes = readBlockScopes()
      if (blockScopes === undefined) {
        throw new Error(
          '[foldkit/native] h.block renders child Blocks only in the view of a Block program.',
        )
      }

      const { scope, toParentMessage } = blockScopes.enter(
        maybeScope ?? blockScopes.root,
        binding,
        options?.key,
      )
      const cached = childBuilders.get(scope)
      const childBuilder =
        cached ??
        withBlocks<unknown>(
          // NOTE: the child builder lifts child Messages into this builder's
          // Message, so it renders this builder's node and attribute types.
          /* eslint-disable-next-line @typescript-eslint/consistent-type-assertions */
          {
            ...mapMessages(
              builder,
              /* eslint-disable-next-line @typescript-eslint/consistent-type-assertions */
              toParentMessage as (message: unknown) => Message,
            ),
            Key: (key: string) => ({ key }),
          } as unknown as Omit<NativeBuilder<unknown>, 'block'>,
          readBlockScopes,
          scope,
        )
      childBuilders.set(scope, childBuilder)

      // NOTE: the child builder renders native nodes whose Messages it lifts
      // into this builder's Message type, so its nodes belong to this view.
      /* eslint-disable-next-line @typescript-eslint/consistent-type-assertions */
      return view(model, childBuilder as never) as NativeNode<Message>
    },
  }

  return builder
}

/** Creates a portable builder whose elements contain data and event mappers.
 * `readBlockScopes` supplies child Block resolution once a Block program's
 * root Block is complete; without it, `block` throws. */
export const makeNativeBuilder = <Message>(
  readBlockScopes: () => BlockScopes | undefined = () => undefined,
): NativeBuilder<Message> => {
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

  return withBlocks<Message>(
    {
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
      screen: (key, attributes, children = []) => ({
        key,
        attributes,
        children,
      }),
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
    },
    readBlockScopes,
    undefined,
  )
}
