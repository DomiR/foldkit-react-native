import { Predicate } from 'effect'

import { isChildAttribute } from '../html/childAttribute.js'
import type { Attribute } from '../html/index.js'
import type { StrictStyle } from './strict.js'

/** Narrows a web attribute to a tagged inline style. @internal */
export const isStyleAttribute = <Message>(
  attribute: Attribute<Message>,
): attribute is Extract<Attribute<Message>, Readonly<{ _tag: 'Style' }>> =>
  !isChildAttribute(attribute) && attribute._tag === 'Style'

const unitlessProperties = new Set(['opacity', 'zIndex', 'fontWeight'])

const toCssValue = (property: string, value: string | number): string =>
  Predicate.isNumber(value) && !unitlessProperties.has(property)
    ? `${value}px`
    : globalThis.String(value)

/** Converts portable lengths, transitions, and transforms to CSS. @internal */
export const toCssProperties = (style: StrictStyle): Record<string, string> => {
  const {
    transitionProperty,
    transitionDuration,
    transitionDelay,
    transitionTimingFunction,
    transform,
    flex,
    padding,
    paddingHorizontal,
    paddingVertical,
    margin,
    marginHorizontal,
    marginVertical,
    ...properties
  } = style
  const expanded = {
    padding,
    margin,
    paddingLeft: paddingHorizontal,
    paddingRight: paddingHorizontal,
    paddingTop: paddingVertical,
    paddingBottom: paddingVertical,
    marginLeft: marginHorizontal,
    marginRight: marginHorizontal,
    marginTop: marginVertical,
    marginBottom: marginVertical,
  }
  const css: Record<string, string> = {}

  for (const [property, value] of [
    ...Object.entries(expanded),
    ...Object.entries(properties),
  ]) {
    if (value !== undefined) {
      const name = property.replace(
        /[A-Z]/g,
        letter => `-${letter.toLowerCase()}`,
      )
      css[name] = toCssValue(property, value)
    }
  }

  if (transitionProperty !== undefined) {
    const properties = Predicate.isString(transitionProperty)
      ? [transitionProperty]
      : transitionProperty
    css['transition-property'] = properties
      .map(property =>
        property.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`),
      )
      .join(', ')
  }
  if (transitionDuration !== undefined) {
    css['transition-duration'] = `${transitionDuration}ms`
  }
  if (transitionDelay !== undefined) {
    css['transition-delay'] = `${transitionDelay}ms`
  }
  if (transitionTimingFunction !== undefined) {
    css['transition-timing-function'] = transitionTimingFunction
  }
  if (transform !== undefined) {
    css['transform'] =
      transform
        .map(operation => {
          if ('translateX' in operation) {
            return `translateX(${operation.translateX}px)`
          }
          if ('translateY' in operation) {
            return `translateY(${operation.translateY}px)`
          }
          if ('scale' in operation) {
            return `scale(${operation.scale})`
          }
          return `rotate(${operation.rotate})`
        })
        .join(' ') || 'none'
  }

  if (flex !== undefined) {
    css['flex-grow'] = globalThis.String(Math.max(0, flex))
    css['flex-shrink'] = globalThis.String(flex > 0 ? 1 : Math.max(0, -flex))
    css['flex-basis'] = flex > 0 ? '0px' : 'auto'
  }

  if (style.textAlign === 'auto') {
    css['text-align'] = 'start'
  }

  return css
}
