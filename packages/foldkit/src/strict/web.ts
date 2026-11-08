import { Array, Option, Predicate } from 'effect'

import { isChildAttribute } from '../html/childAttribute.js'
import type { Attribute, Html, HtmlBuilder } from '../html/index.js'
import { createKeyedLazy } from '../html/lazy.js'
import type {
  AnimatedStyleBinding,
  StrictLayoutAnimation,
} from './animation.js'
import type { StrictGesture } from './gesture.js'
import type { StrictIcon } from './icon.js'
import type {
  StrictHtmlBuilder,
  StrictView,
  StrictScreen,
  StrictStyle,
  StrictTag,
} from './strict.js'
import type { WebAnimationHost } from './webAnimation.js'
import { renderStrictElement } from './webBindings.js'
import { renderStrictList } from './webList.js'
import { isStyleAttribute, toCssProperties } from './webStyle.js'

type NavigationAttributes<Message> = Readonly<{
  title?: string
  tabIcon?: StrictIcon
  onDismissed?: (dismissedCount: number) => Message
  isBackTitleVisible?: boolean
  selectedTab?: string
  onSelectTab?: (key: string) => Message
  gestures?: ReadonlyArray<StrictGesture<Message>>
  animatedStyles?: ReadonlyArray<AnimatedStyleBinding>
  entering?: StrictLayoutAnimation
  exiting?: StrictLayoutAnimation
  onTransitionEnd?: Message
  onEndReached?: Message
}>

const unkeyedLazy = Symbol('unkeyed')
const webLazySlots = new WeakMap<object, ReturnType<typeof createKeyedLazy>>()

const resolveWebLazy = <Args extends ReadonlyArray<unknown>>(
  slot: object,
  key: PropertyKey | undefined,
  view: (...args: Args) => Html,
  args: Args,
): Html => {
  const keyedLazy = webLazySlots.get(slot) ?? createKeyedLazy()
  webLazySlots.set(slot, keyedLazy)

  return keyedLazy(key ?? unkeyedLazy, view, args)
}

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
 * Portable transitions use CSS transitions and Entering uses CSS keyframes, both
 * with reduced-motion support.
 * Web animation Commands resolve at their target when reduced motion is active.
 * Removed elements with Exiting stay inert until their exit keyframes end.
 * Reduced motion and DevTools replay remove them at once. Re-adding the same
 * key while its ghost exits renders a new element beside the ghost, as on native.
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
  const readPortableStyle = (
    attributes: ReadonlyArray<Attribute<Message>>,
  ): StrictStyle =>
    attributes.reduce<StrictStyle>(
      (style, attribute) => ({ ...style, ...styleValues.get(attribute) }),
      {},
    )

  const attributesFor = (
    tag: StrictTag,
    attributes: ReadonlyArray<Attribute<Message>>,
    portableStyle: StrictStyle,
    isStickyFooter = false,
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
    const style = attributes.reduce<Record<string, string>>(
      (style, attribute) =>
        isStyleAttribute(attribute) && !styleValues.has(attribute)
          ? { ...style, ...attribute.value }
          : style,
      {
        ...defaults,
        ...(isControl ? controlDefaults : {}),
        ...(tag === 'textarea' ? textareaDefaults : {}),
      },
    )
    const css = {
      ...style,
      ...toCssProperties(portableStyle),
      ...(isStickyFooter
        ? {
            position: 'sticky',
            bottom: '0px',
            'z-index': '1',
            ...(portableStyle.backgroundColor === undefined
              ? { 'background-color': 'inherit' }
              : {}),
          }
        : {}),
    }
    const isCheckbox =
      tag === 'input' &&
      attributes.some(
        attribute =>
          !isChildAttribute(attribute) && attribute._tag === 'Checked',
      )
    const inputType = isCheckbox ? 'checkbox' : 'text'
    const controlAttributes: Array<Attribute<Message>> = []
    if (tag === 'button') {
      controlAttributes.push(h.Type('button'))
    } else if (tag === 'input') {
      controlAttributes.push(h.Type(inputType))
      if (isCheckbox) {
        controlAttributes.push(h.Role('switch'))
      }
    }

    return [
      ...controlAttributes,
      ...Array.filter(
        attributes,
        attribute =>
          !isStyleAttribute(attribute) &&
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
    isStickyFooter = false,
  ): Html => {
    const portableStyle = readPortableStyle(attributes)
    const isTransitioned =
      (portableStyle.transitionProperty !== undefined ||
        portableStyle.transitionDuration !== undefined ||
        portableStyle.transitionDelay !== undefined ||
        portableStyle.transitionTimingFunction !== undefined) &&
      portableStyle.transitionProperty !== 'none'
    const normalizedAttributes = attributesFor(
      tag,
      attributes,
      portableStyle,
      isStickyFooter,
    )
    const bindings = readNavigation(attributes)
    return renderStrictElement(
      h,
      tag,
      normalizedAttributes,
      children,
      { ...bindings, isTransitioned },
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

  const childViews = new WeakMap<
    StrictView<any, any>,
    (model: unknown, childH: HtmlBuilder<unknown>) => Html
  >()
  const childViewFor = (view: StrictView<any, any>) => {
    const cached = childViews.get(view)
    if (cached !== undefined) {
      return cached
    }

    const childView = (model: unknown, childH: HtmlBuilder<unknown>): Html =>
      view(model, toStrictHtml(childH, animationHost))
    childViews.set(view, childView)
    return childView
  }
  const renderBlock = (
    binding: object,
    model: unknown,
    view: StrictView<any, any>,
    options: Readonly<{ key: unknown }> | undefined,
  ): Html => {
    const embedView = Reflect.get(binding, 'embedView')
    const block = Reflect.get(h, 'block')
    if (!Predicate.isFunction(embedView) || !Predicate.isFunction(block)) {
      throw new Error(
        '[foldkit] h.block in a strict view requires a Block view builder and a child Binding.',
      )
    }

    const slotId =
      options === undefined
        ? globalThis.String(Reflect.get(binding, 'placement'))
        : globalThis.String(options.key)
    const embedding = Reflect.apply(embedView, binding, [
      {
        ...options,
        slotId,
        model,
        view: childViewFor(view),
      },
    ])
    // NOTE: h.block returns the child's rendered Html.
    /* eslint-disable-next-line @typescript-eslint/consistent-type-assertions */
    return Reflect.apply(block, h, [embedding]) as Html
  }
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
    footer: element('footer'),
    stickyFooter: (attributes, children) =>
      buildElement('footer', attributes, children, undefined, true),
    keyed:
      (tag: StrictTag) =>
      (
        key: string,
        attributes: ReadonlyArray<Attribute<Message>>,
        children?: ReadonlyArray<Html | string | null>,
      ): Html =>
        buildElement(tag, attributes, children, key),
    list: (attributes, list) =>
      renderStrictList(
        h,
        builder,
        attributes,
        list,
        readNavigation(attributes).onEndReached,
      ),
    screen: (key, attributes, children = []) => ({ key, attributes, children }),
    tab: (key, attributes, children = []) => ({ key, attributes, children }),
    stack: (attributes, screens) =>
      Option.match(Array.last(screens), {
        onNone: () => builder.empty,
        onSome: screen => {
          const { onDismissed, isBackTitleVisible = true } =
            readNavigation(attributes)
          const back =
            screens.length > 1 && onDismissed !== undefined
              ? builder.button(
                  [
                    builder.Style({ padding: 12, color: '#182c25' }),
                    builder.OnClick(onDismissed(1)),
                    builder.AriaLabel('Back'),
                  ],
                  [isBackTitleVisible ? 'Back' : '‹'],
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
            [
              h.Role('tabpanel'),
              h.AriaLabel(readTitle(tab)),
              h.Style(bodyStyle),
              ...tab.attributes,
            ],
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
    BackTitleVisible: isBackTitleVisible =>
      navigationAttribute({ isBackTitleVisible }),
    SelectedTab: selectedTab => navigationAttribute({ selectedTab }),
    OnSelectTab: onSelectTab => navigationAttribute({ onSelectTab }),
    ImmediateTabSelection: () => navigationAttribute({}),
    Gesture: gesture => navigationAttribute({ gestures: [gesture] }),
    empty: h.empty,
    lazy: resolveWebLazy,
    block: (binding, model, view, options) =>
      renderBlock(binding, model, view, options),
    Style: style => {
      const attribute = h.Style(toCssProperties(style))
      styleValues.set(attribute, style)
      return attribute
    },
    OnClick: h.OnClick,
    OnEndReached: onEndReached => navigationAttribute({ onEndReached }),
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
