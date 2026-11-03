import {
  Array,
  Effect,
  Function,
  Predicate,
  Queue,
  Schema,
  Stream,
} from 'effect'

import { brandViewResult } from '../brand/brand.js'
import {
  Prop,
  type Attribute,
  type Html,
  type HtmlBuilder,
} from '../html/index.js'
import type {
  AnimatedStyleBinding,
  StrictLayoutAnimation,
} from './animation.js'
import type { StrictGesture } from './gesture.js'
import type { StrictTag } from './strict.js'
import type { WebAnimationHost } from './webAnimation.js'
import { listenForGestures } from './webGestures.js'
import { toCssProperties } from './webStyle.js'

type Bindings<Message> = Readonly<{
  gestures?: ReadonlyArray<StrictGesture<Message>>
  animatedStyles?: ReadonlyArray<AnimatedStyleBinding>
  entering?: StrictLayoutAnimation
  onTransitionEnd?: Message
}>

const BINDINGS_PROPERTY = '__foldkitStrictBindings'
const DEFAULT_LAYOUT_MS = 300
const styledDocuments = new WeakSet<Document>()
const KEYFRAMES = `
@keyframes foldkit-strict-FadeIn { from { opacity: 0 } to { opacity: 1 } }
@keyframes foldkit-strict-FadeOut { from { opacity: 1 } to { opacity: 0 } }
@keyframes foldkit-strict-SlideInRight { from { transform: translateX(100vw) } to { transform: translateX(0) } }
@keyframes foldkit-strict-SlideOutLeft { from { transform: translateX(0) } to { transform: translateX(-100vw) } }
@keyframes foldkit-strict-ZoomIn { from { transform: scale(0); opacity: 0 } to { transform: scale(1); opacity: 1 } }
@keyframes foldkit-strict-ZoomOut { from { transform: scale(1); opacity: 1 } to { transform: scale(0); opacity: 0 } }
`

const ensureKeyframes = (document: Document): void => {
  if (styledDocuments.has(document)) {
    return
  }
  const style = document.createElement('style')
  style.textContent = KEYFRAMES
  document.head.appendChild(style)
  styledDocuments.add(document)
}

/** Builds elements with one scoped Mount for animation and gesture bindings.
 * The transparent wrapper preserves application view identity. @internal */
export const renderStrictElement = <Message>(
  h: HtmlBuilder<Message>,
  tag: StrictTag,
  attributes: ReadonlyArray<Attribute<Message>>,
  children: ReadonlyArray<Html | string | null> | undefined,
  bindings: Bindings<Message>,
  host: WebAnimationHost | undefined,
  key?: string,
): Html => {
  const isGestured = Array.isReadonlyArrayNonEmpty(bindings.gestures ?? [])
  const isAnimatedBinding = Array.isReadonlyArrayNonEmpty(
    bindings.animatedStyles ?? [],
  )
  const isBound =
    isGestured ||
    isAnimatedBinding ||
    bindings.entering !== undefined ||
    bindings.onTransitionEnd !== undefined
  if (!isBound) {
    if (key === undefined) {
      return h[tag](attributes, children)
    } else {
      return h.keyed(tag)(key, attributes, children)
    }
  }
  const isTrackedPan =
    bindings.gestures?.some(
      gesture =>
        gesture._tag === 'Pan' &&
        (gesture.trackX !== undefined || gesture.trackY !== undefined),
    ) ?? false
  if (host === undefined && (isTrackedPan || isAnimatedBinding)) {
    throw new Error(
      'Strict animated bindings require a WebAnimationHost passed to toStrictHtml.',
    )
  }
  const baseCss = attributes.reduce<Record<string, string>>(
    (css, attribute) =>
      attribute._tag === 'Style' ? { ...css, ...attribute.value } : css,
    {},
  )
  const readCss = (current: Bindings<Message>): Record<string, string> => {
    const animatedCss = (current.animatedStyles ?? []).reduce<
      Record<string, string>
    >(
      (css, binding) => ({
        ...css,
        ...toCssProperties(
          binding.mapper(host?.read(binding.key) ?? binding.key.initial),
        ),
      }),
      {},
    )
    return { ...baseCss, ...animatedCss }
  }
  const enteringCss =
    bindings.entering === undefined
      ? {}
      : {
          'animation-name': `foldkit-strict-${bindings.entering._tag}`,
          'animation-duration': `${bindings.entering.durationMs ?? DEFAULT_LAYOUT_MS}ms`,
          'animation-fill-mode': 'backwards',
        }
  const gestureCss = isGestured
    ? { 'touch-action': 'none', 'user-select': 'none' }
    : {}
  const css = { ...readCss(bindings), ...enteringCss, ...gestureCss }
  const ReadBindings = Schema.declare<
    () => Readonly<{ bindings: Bindings<Message>; css: Record<string, string> }>
  >(
    (
      input,
    ): input is () => Readonly<{
      bindings: Bindings<Message>
      css: Record<string, string>
    }> => Predicate.isFunction(input),
  )
  const decodeReadBindings = Schema.decodeUnknownSync(ReadBindings)
  const target = h[tag](
    [
      ...attributes,
      ...(isGestured ? [h.DataAttribute('foldkit-strict-gesture', '')] : []),
      h.Style(css),
      Prop({
        key: BINDINGS_PROPERTY,
        value: () => ({
          bindings,
          css: { ...baseCss, ...enteringCss, ...gestureCss },
        }),
      }),
      h.OnMount({
        name: 'ObserveStrictBindings',
        f: element =>
          Stream.callback<Message>(queue =>
            Effect.gen(function* () {
              if (!(element instanceof HTMLElement)) {
                return yield* Effect.never
              }
              const readCurrent = () =>
                decodeReadBindings(Reflect.get(element, BINDINGS_PROPERTY))()
              const emit = (message: Message) => {
                Queue.offerUnsafe(queue, message)
              }
              const transitionEnd = (event: TransitionEvent): void => {
                const { onTransitionEnd } = readCurrent().bindings
                if (event.target === element && onTransitionEnd !== undefined) {
                  emit(onTransitionEnd)
                }
              }
              yield* Effect.acquireRelease(
                Effect.sync(() => {
                  if (bindings.entering !== undefined) {
                    ensureKeyframes(element.ownerDocument)
                  }
                  const removeGestures = isGestured
                    ? listenForGestures(
                        element,
                        () => readCurrent().bindings.gestures ?? [],
                        emit,
                        host,
                      )
                    : Function.constVoid
                  let previousProperties = new Set(Object.keys(css))
                  const unsubscribe =
                    isAnimatedBinding && host !== undefined
                      ? host.subscribe(() => {
                          const current = readCurrent()
                          const nextCss = (
                            current.bindings.animatedStyles ?? []
                          ).reduce<Record<string, string>>(
                            (css, binding) => ({
                              ...css,
                              ...toCssProperties(
                                binding.mapper(host.read(binding.key)),
                              ),
                            }),
                            current.css,
                          )
                          for (const property of previousProperties) {
                            if (!(property in nextCss)) {
                              element.style.removeProperty(property)
                            }
                          }
                          for (const [property, value] of Object.entries(
                            nextCss,
                          )) {
                            element.style.setProperty(property, value)
                          }
                          previousProperties = new Set(Object.keys(nextCss))
                        })
                      : undefined
                  element.addEventListener('transitionend', transitionEnd)
                  return () => {
                    removeGestures()
                    unsubscribe?.()
                    element.removeEventListener('transitionend', transitionEnd)
                  }
                }),
                dispose => Effect.sync(dispose),
              )
              return yield* Effect.never
            }),
          ),
      }),
    ],
    children,
  )
  // NOTE: Replacing the inner target disposes its Mount when the final binding
  // is removed, including when both branches produce the same HTML tag.
  const targetIdentity = [
    'foldkit/strict/boundTarget',
    isGestured ? 'gestures' : 'plain',
    isAnimatedBinding ? 'animated' : 'static',
  ].join('/')
  const brandedTarget = brandViewResult(target, targetIdentity)
  const wrapperAttributes = [h.Style({ display: 'contents' })]
  if (key === undefined) {
    return h.div(wrapperAttributes, [brandedTarget])
  } else {
    return h.keyed('div')(key, wrapperAttributes, [brandedTarget])
  }
}
