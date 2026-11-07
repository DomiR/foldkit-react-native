import type { StrictHtmlBuilder } from './strict.js'

/** A view function that receives the builder it renders with. @experimental */
export type StrictLazyView<
  Message,
  Node,
  Attribute,
  Args extends ReadonlyArray<unknown>,
> = (h: StrictHtmlBuilder<Message, Node, Attribute>, ...args: Args) => Node

/** Creates a memoization slot for a strict view function. On each render, if
 * the builder, the view function, and every argument are equal by reference to
 * the previous call, the host reuses the cached node instead of calling the
 * view again. The native renderer then skips the whole subtree, so a screen
 * that did not change costs nothing when another part of the Model changes.
 * The web host behaves like `createLazy` from `foldkit/html`.
 *
 * Define the slot and the view function at module level, and pass only the
 * Model fields the view reads:
 *
 * ```ts
 * const lazyTypography = createStrictLazy()
 *
 * const typographyScreen = <Node, Attribute>(
 *   h: StrictHtmlBuilder<Message, Node, Attribute>,
 *   typography: Typography,
 * ): Node => h.div([], [...])
 *
 * // in the view
 * h.tab('typography', [h.Title('Typography')], [
 *   lazyTypography(h, typographyScreen, [model.typography]),
 * ])
 * ```
 *
 * The builder is part of the cache key. A builder from `mapMessages` is reused
 * for the same parent builder and the same `toParentMessage` function, so pass
 * a Message constructor or a module-level function there, not an inline arrow.
 *
 * Render each cached node at a single position. If the same content appears
 * at several positions, use one slot per position or `createStrictKeyedLazy`.
 * @experimental */
export const createStrictLazy = (): (<
  Message,
  Node,
  Attribute,
  Args extends ReadonlyArray<unknown>,
>(
  h: StrictHtmlBuilder<Message, Node, Attribute>,
  view: StrictLazyView<Message, Node, Attribute, Args>,
  args: Args,
) => Node) => {
  const slot = {}

  return (h, view, args) => h.lazy(slot, undefined, view, [h, ...args])
}

/** Creates a keyed memoization map for one strict view function rendered under
 * many keys, such as one detail screen per route. Each key caches
 * independently, compared like `createStrictLazy`. Entries are never evicted,
 * so keys must come from a bounded set. @experimental */
export const createStrictKeyedLazy = (): (<
  Message,
  Node,
  Attribute,
  Args extends ReadonlyArray<unknown>,
>(
  key: PropertyKey,
  h: StrictHtmlBuilder<Message, Node, Attribute>,
  view: StrictLazyView<Message, Node, Attribute, Args>,
  args: Args,
) => Node) => {
  const slot = {}

  return (key, h, view, args) => h.lazy(slot, key, view, [h, ...args])
}
