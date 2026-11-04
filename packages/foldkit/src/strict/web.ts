import { Array, Option } from 'effect'

import type { Attribute, Html, HtmlBuilder } from '../html/index.js'
import type {
  AnimatedStyleBinding,
  StrictLayoutAnimation,
} from './animation.js'
import type { StrictGesture } from './gesture.js'
import type { StrictIcon } from './icon.js'
import type {
  StrictHtmlBuilder,
  StrictScreen,
  StrictStyle,
  StrictTag,
} from './strict.js'
import type { WebAnimationHost } from './webAnimation.js'
import { renderStrictElement } from './webBindings.js'
import { toCssProperties } from './webStyle.js'

type NavigationAttributes<Message> = Readonly<{
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
}>

const layoutDefaults: Record<string, string> = {
  display: 'flex',
  'flex-direction': 'column',
  'flex-shrink': '0',
  'align-items': 'stretch',
  'box-sizing': 'border-box',
  position: 'relative',
  'min-width': '0px',
  margin: '0px',
  padding: '0px',
  'border-width': '0px',
  'border-style': 'solid',
  'border-color': '#000000',
  'list-style': 'none',
}

const textDefaults: Record<string, string> = {
  margin: '0px',
  padding: '0px',
  'font-size': 'inherit',
  'font-weight': 'inherit',
  'font-style': 'inherit',
  'box-sizing': 'border-box',
  'min-width': '0px',
}

const controlDefaults: Record<string, string> = {
  appearance: 'none',
  'background-color': 'transparent',
  'border-radius': '0px',
  font: 'inherit',
  color: 'inherit',
  'text-align': 'inherit',
}

const textareaDefaults: Record<string, string> = {
  resize: 'none',
}

const navigationStyle: Record<string, string> = {
  height: '100%',
  'max-height': '100dvh',
  'min-height': '0px',
  'min-width': '0px',
  overflow: 'hidden',
  flex: '1 1 0%',
}
const bodyStyle: Record<string, string> = {
  'min-height': '0px',
  'min-width': '0px',
  overflow: 'auto',
  flex: '1 1 0%',
  'overscroll-behavior-y': 'contain',
}

/** Adapts a web HtmlBuilder to the portable strict subset. It applies native
 * layout defaults, resets controls, and converts numeric lengths to CSS pixels.
 * Entering uses CSS keyframes. Exiting does not delay web element removal.
 * @experimental The strict adapter contract may change between releases. */
export const toStrictHtml = <Message>(
  h: HtmlBuilder<Message>,
  animationHost?: WebAnimationHost,
): StrictHtmlBuilder<Message, Html, Attribute<Message>> => {
  const styleValues = new WeakMap<Attribute<Message>, StrictStyle>()
  const submitEditingAttributes = new WeakSet<Attribute<Message>>()
  const navigationValues = new WeakMap<
    Attribute<Message>,
    NavigationAttributes<Message>
  >()
  const navigationAttribute = (
    value: NavigationAttributes<Message>,
  ): Attribute<Message> => {
    const attribute = h.Title('')
    navigationValues.set(attribute, value)
    return attribute
  }
  const readNavigation = (
    attributes: ReadonlyArray<Attribute<Message>>,
  ): NavigationAttributes<Message> =>
    attributes.reduce<NavigationAttributes<Message>>(
      (navigation, attribute) => {
        const value = navigationValues.get(attribute)
        return {
          ...navigation,
          ...value,
          animatedStyles: [
            ...(navigation.animatedStyles ?? []),
            ...(value?.animatedStyles ?? []),
          ],
          gestures: [
            ...(navigation.gestures ?? []),
            ...(value?.gestures ?? []),
          ],
        }
      },
      {},
    )
  const readTitle = (screen: StrictScreen<Html, Attribute<Message>>): string =>
    readNavigation(screen.attributes).title ?? screen.key

  const attributesFor = (
    tag: StrictTag,
    attributes: ReadonlyArray<Attribute<Message>>,
  ): ReadonlyArray<Attribute<Message>> => {
    const isText =
      tag === 'span' ||
      tag === 'p' ||
      tag === 'h1' ||
      tag === 'h2' ||
      tag === 'h3' ||
      tag === 'label'
    const defaults = {
      ...layoutDefaults,
      ...(isText ? textDefaults : {}),
      ...(tag === 'span' ? { display: 'inline' } : {}),
    }
    const isControl = tag === 'button' || tag === 'input' || tag === 'textarea'
    const portableStyle = attributes.reduce<StrictStyle>(
      (style, attribute) => ({ ...style, ...styleValues.get(attribute) }),
      {},
    )
    const style = attributes.reduce<Record<string, string>>(
      (style, attribute) =>
        attribute._tag === 'Style' && !styleValues.has(attribute)
          ? { ...style, ...attribute.value }
          : style,
      {
        ...defaults,
        ...(isControl ? controlDefaults : {}),
        ...(tag === 'textarea' ? textareaDefaults : {}),
      },
    )
    const css = { ...style, ...toCssProperties(portableStyle) }
    const isCheckbox =
      tag === 'input' &&
      attributes.some(attribute => attribute._tag === 'Checked')
    const inputType = isCheckbox ? 'checkbox' : 'text'
    const controlAttributes: Array<Attribute<Message>> = []
    if (tag === 'button') {
      controlAttributes.push(h.Type('button'))
    } else if (tag === 'input') {
      controlAttributes.push(h.Type(inputType))
    }

    return [
      ...controlAttributes,
      ...Array.filter(
        attributes,
        attribute =>
          attribute._tag !== 'Style' &&
          !navigationValues.has(attribute) &&
          !(tag === 'textarea' && submitEditingAttributes.has(attribute)),
      ),
      h.Style(css),
    ]
  }
  const buildElement = (
    tag: StrictTag,
    attributes: ReadonlyArray<Attribute<Message>>,
    children?: ReadonlyArray<Html | string | null>,
    key?: string,
  ): Html => {
    const normalizedAttributes = attributesFor(tag, attributes)
    const bindings = readNavigation(attributes)
    return renderStrictElement(
      h,
      tag,
      normalizedAttributes,
      children,
      bindings,
      animationHost,
      key,
    )
  }

  const element =
    (tag: StrictTag) =>
    (
      attributes: ReadonlyArray<Attribute<Message>>,
      children?: ReadonlyArray<Html | string | null>,
    ) =>
      buildElement(tag, attributes, children)

  const builder: StrictHtmlBuilder<Message, Html, Attribute<Message>> = {
    div: element('div'),
    span: element('span'),
    p: element('p'),
    h1: element('h1'),
    h2: element('h2'),
    h3: element('h3'),
    label: element('label'),
    button: element('button'),
    input: element('input'),
    textarea: attributes => buildElement('textarea', attributes),
    img: element('img'),
    ul: element('ul'),
    li: element('li'),
    keyed:
      (tag: StrictTag) =>
      (
        key: string,
        attributes: ReadonlyArray<Attribute<Message>>,
        children?: ReadonlyArray<Html | string | null>,
      ): Html =>
        buildElement(tag, attributes, children, key),
    screen: (key, attributes, children = []) => ({ key, attributes, children }),
    tab: (key, attributes, children = []) => ({ key, attributes, children }),
    stack: (attributes, screens) =>
      Option.match(Array.last(screens), {
        onNone: () => builder.empty,
        onSome: screen => {
          const { onDismissed } = readNavigation(attributes)
          const back =
            screens.length > 1 && onDismissed !== undefined
              ? builder.button(
                  [
                    builder.Style({ padding: 12, color: '#182c25' }),
                    builder.OnClick(onDismissed(1)),
                    builder.AriaLabel('Back'),
                  ],
                  ['Back'],
                )
              : builder.empty

          return builder.div(
            [h.Style(navigationStyle), ...attributes],
            [
              builder.div(
                [
                  builder.Style({
                    flexDirection: 'row',
                    alignItems: 'center',
                    padding: 12,
                    gap: 12,
                  }),
                ],
                [
                  back,
                  builder.h2(
                    [
                      builder.Style({
                        fontSize: 20,
                        fontWeight: 'bold',
                        color: '#182c25',
                      }),
                    ],
                    [readTitle(screen)],
                  ),
                ],
              ),
              builder.keyed('div')(
                screen.key,
                [h.Style(bodyStyle), ...screen.attributes],
                screen.children,
              ),
            ],
          )
        },
      }),
    tabs: (attributes, tabs) => {
      const { selectedTab, onSelectTab } = readNavigation(attributes)
      const maybeSelectedKey = Option.orElse(
        Option.fromNullishOr(selectedTab),
        () => Option.map(Array.head(tabs), tab => tab.key),
      )
      const selected = Option.getOrUndefined(maybeSelectedKey)
      const maybeSelectedTab = Array.findFirst(
        tabs,
        tab => tab.key === selected,
      )
      const content = Option.match(maybeSelectedTab, {
        onNone: () => builder.empty,
        onSome: tab =>
          builder.keyed('div')(
            tab.key,
            [h.Style(bodyStyle), ...tab.attributes],
            tab.children,
          ),
      })

      return builder.div(
        [h.Style(navigationStyle), ...attributes],
        [
          content,
          builder.div(
            [
              builder.Style({
                flexDirection: 'row',
                gap: 8,
                padding: 12,
                backgroundColor: '#dce5df',
              }),
              h.Role('tablist'),
            ],
            Array.map(tabs, tab =>
              builder.keyed('button')(
                tab.key,
                [
                  ...tab.attributes,
                  builder.Style({
                    flex: 1,
                    padding: 14,
                    alignItems: 'center',
                    gap: 4,
                    color: tab.key === selected ? '#ffffff' : '#182c25',
                    backgroundColor:
                      tab.key === selected ? '#182c25' : 'transparent',
                    borderRadius: 8,
                  }),
                  h.Role('tab'),
                  h.AriaSelected(tab.key === selected),
                  ...(onSelectTab === undefined
                    ? [builder.Disabled(true)]
                    : [builder.OnClick(onSelectTab(tab.key))]),
                ],
                [
                  ...Option.toArray(
                    Option.map(
                      Option.fromNullishOr(
                        readNavigation(tab.attributes).tabIcon?.webGlyph,
                      ),
                      glyph =>
                        builder.span(
                          [h.AriaHidden(true), builder.Style({ fontSize: 22 })],
                          [glyph],
                        ),
                    ),
                  ),
                  builder.span([], [readTitle(tab)]),
                ],
              ),
            ),
          ),
        ],
      )
    },
    OnTransitionEnd: onTransitionEnd =>
      navigationAttribute({ onTransitionEnd }),
    Entering: entering => navigationAttribute({ entering }),
    Exiting: exiting => navigationAttribute({ exiting }),
    AnimatedStyle: (key, mapper) =>
      navigationAttribute({ animatedStyles: [{ key, mapper }] }),
    Title: title => navigationAttribute({ title }),
    TabIcon: tabIcon => navigationAttribute({ tabIcon }),
    OnDismissed: onDismissed => navigationAttribute({ onDismissed }),
    SelectedTab: selectedTab => navigationAttribute({ selectedTab }),
    OnSelectTab: onSelectTab => navigationAttribute({ onSelectTab }),
    Gesture: gesture => navigationAttribute({ gestures: [gesture] }),
    empty: h.empty,
    Style: style => {
      const attribute = h.Style(toCssProperties(style))
      styleValues.set(attribute, style)
      return attribute
    },
    OnClick: h.OnClick,
    OnInput: h.OnInput,
    OnSubmitEditing: message => {
      const attribute = h.OnKeyDownPreventDefault(key =>
        key === 'Enter' ? Option.some(message) : Option.none(),
      )
      submitEditingAttributes.add(attribute)
      return attribute
    },
    Value: h.Value,
    Rows: h.Rows,
    Placeholder: h.Placeholder,
    Src: h.Src,
    Alt: h.Alt,
    AriaLabel: h.AriaLabel,
    Disabled: h.Disabled,
    Checked: h.Checked,
  }

  return builder
}

export { makeWebAnimationHost } from './webAnimation.js'
export type { WebAnimationHost } from './webAnimation.js'
