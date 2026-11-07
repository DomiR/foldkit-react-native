import { Array, Option, Predicate } from 'effect'

import type { NativeChild, NativeFooterLift, NativeNode } from './node'

const once = <A>(compute: () => A): (() => A) => {
  let maybeValue = Option.none<A>()
  return () => {
    if (Option.isSome(maybeValue)) {
      return maybeValue.value
    }
    const value = compute()
    maybeValue = Option.some(value)
    return value
  }
}

/** Wraps a node reused by lazy. A footer lifted out of it, and the body left
 * behind, are wrapped too, so both keep stable references across renders.
 * @internal */
export const makeLazyNode = <Message>(
  node: NativeNode<Message>,
): NativeNode<Message> => ({
  _tag: 'Lazy',
  node,
  liftStickyFooter: once(() =>
    Option.map(
      liftStickyFooter([node]),
      ({ footer, children }): NativeFooterLift<Message> => ({
        footer: {
          _tag: 'Lazy',
          node: footer,
          liftStickyFooter: () => Option.none(),
        },
        children: Array.map(children, child =>
          child === null || Predicate.isString(child)
            ? child
            : makeLazyNode(child),
        ),
      }),
    ),
  ),
})

/** Lifts the first sticky footer without entering lists or navigation containers. @internal */
export const liftStickyFooter = <Message>(
  children: ReadonlyArray<NativeChild<Message>>,
): Option.Option<NativeFooterLift<Message>> =>
  Array.findFirst(children, (child, index) => {
    if (child === null || Predicate.isString(child)) {
      return Option.none()
    }

    if (child._tag === 'Lazy') {
      return Option.map(child.liftStickyFooter(), footerLift => ({
        footer: footerLift.footer,
        children: [
          ...children.slice(0, index),
          ...footerLift.children,
          ...children.slice(index + 1),
        ],
      }))
    }

    if (child._tag !== 'Element') {
      return Option.none()
    }

    if (child.attributes.isStickyFooter === true) {
      return Option.some({
        footer: child,
        children: Array.remove(children, index),
      })
    }

    return Option.map(liftStickyFooter(child.children), footerLift => ({
      footer: footerLift.footer,
      children: Array.map(children, (sibling, siblingIndex) =>
        siblingIndex === index
          ? { ...child, children: footerLift.children }
          : sibling,
      ),
    }))
  })
