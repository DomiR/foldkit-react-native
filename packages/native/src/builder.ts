import type { StrictHtmlBuilder } from 'foldkit/strict'

import type {
  NativeAttribute,
  NativeChild,
  NativeNode,
  NativeTag,
} from './node'

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

/** Creates a portable builder whose elements contain data and event mappers.
 * Native runtimes stamp input frames with the latest reported edit revision. */
export const makeNativeBuilder = <Message>(
  readInputRevision: () => number = () => 0,
): NativeBuilder<Message> => {
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
      ...(tag === 'input' ? { inputRevision: readInputRevision() } : {}),
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
    img: element('img'),
    ul: element('ul'),
    li: element('li'),
    keyed: tag => (key, attributes, children) =>
      buildElement(tag, attributes, children, key),
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
    SelectedTab: selectedTab => ({ selectedTab }),
    OnSelectTab: onSelectTab => ({ onSelectTab }),
    Gesture: gesture => ({ gestures: [gesture] }),
    empty: { _tag: 'Empty' },
    Style: style => ({ style }),
    OnClick: message => ({ onClick: message }),
    OnInput: toMessage => ({ onInput: toMessage }),
    OnSubmitEditing: message => ({ onSubmitEditing: message }),
    Value: value => ({ value }),
    Placeholder: placeholder => ({ placeholder }),
    Src: src => ({ src }),
    Alt: alt => ({ alt }),
    Key: key => ({ key }),
    AriaLabel: ariaLabel => ({ ariaLabel }),
    Disabled: isDisabled => ({ isDisabled }),
    Checked: isChecked => ({ isChecked }),
  }
}
