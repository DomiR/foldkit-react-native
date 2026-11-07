import { Predicate } from 'effect'

type BrandableNativeNode = Record<string, unknown> & {
  _tag: 'Element' | 'List' | 'Stack' | 'Tabs'
  identity?: string
}

const hasOwnProperty = (
  value: Record<string, unknown>,
  property: string,
): boolean => Object.prototype.hasOwnProperty.call(value, property)

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!Predicate.isObject(value)) {
    return false
  }

  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const isBrandableNativeNode = (
  value: unknown,
): value is BrandableNativeNode => {
  if (!isPlainObject(value) || !Object.isExtensible(value)) {
    return false
  }

  if (value['_tag'] === 'Element') {
    return (
      hasOwnProperty(value, 'tag') &&
      hasOwnProperty(value, 'attributes') &&
      hasOwnProperty(value, 'children') &&
      hasOwnProperty(value, 'key')
    )
  } else if (value['_tag'] === 'List') {
    return (
      hasOwnProperty(value, 'key') &&
      hasOwnProperty(value, 'attributes') &&
      hasOwnProperty(value, 'rows')
    )
  } else if (value['_tag'] === 'Stack') {
    return (
      hasOwnProperty(value, 'attributes') && hasOwnProperty(value, 'screens')
    )
  } else if (value['_tag'] === 'Tabs') {
    return hasOwnProperty(value, 'attributes') && hasOwnProperty(value, 'tabs')
  } else {
    return false
  }
}

const stampIdentity = (target: BrandableNativeNode, identity: string): void => {
  if (target.identity === undefined) {
    target.identity = identity
  }
}

const stampResult = (value: unknown, identity: string): void => {
  if (isBrandableNativeNode(value)) {
    stampIdentity(value, identity)
  } else if (isPlainObject(value) && value['_tag'] === 'Lazy') {
    // NOTE: a Lazy node wraps the node it reuses; the identity belongs to
    // that node, which keeps it set-if-absent across cache hits.
    stampResult(value['node'], identity)
  }
}

/**
 * Stamps a framework-managed identity onto a native Element, List, Stack, or
 * Tabs view result, or onto the node a Lazy view result reuses.
 *
 * Identity is the renderer's second axis, independent of user-facing keys:
 * it answers which view function produced this node rather than which sibling
 * this is. An identity mismatch remounts the native subtree instead of
 * patching it, so switching between conditional view arms tears down the old
 * subtree even when both arms render the same native tag.
 *
 * Stamping is set-if-absent and mutates a native node in place. A node that
 * already carries an identity is left untouched. For an array result, each
 * native node element is stamped with the same identity. Any other value,
 * including a frozen or non-native object, passes through unchanged.
 *
 * `@foldkit/vite-plugin` injects a call to this around every function return
 * in application modules at build time. Application code does not call it by
 * hand.
 */
export const brandViewResult = <A>(result: A, identity: string): A => {
  if (globalThis.Array.isArray(result)) {
    for (const element of result) {
      stampResult(element, identity)
    }
  } else {
    stampResult(result, identity)
  }

  return result
}
