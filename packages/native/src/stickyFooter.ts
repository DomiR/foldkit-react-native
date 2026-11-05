import { Array, Option, Predicate } from 'effect'

import type { NativeChild, NativeNode } from './node'

/** Lifts the first sticky footer without entering lists or navigation containers. @internal */
export const liftStickyFooter = <Message>(
  children: ReadonlyArray<NativeChild<Message>>,
): Option.Option<
  Readonly<{
    footer: NativeNode<Message>
    children: ReadonlyArray<NativeChild<Message>>
  }>
> =>
  Array.findFirst(children, (child, index) => {
    if (
      child === null ||
      Predicate.isString(child) ||
      child._tag !== 'Element'
    ) {
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
