import { Predicate } from 'effect'

import { bindingResolverOf } from '../block/bindingConnection.js'
import { canonicalBindingOf, runtimeBindingOf } from '../block/composition.js'
import { executionBindingsOf } from '../experimental/constructed/symbolic.js'
import { toParentMessage } from '../test/toParentMessage.js'
import { mapMessages } from './mapMessages.js'
import type { StrictHtmlBuilder, StrictView } from './strict.js'

const unkeyed = Symbol('unkeyed')
const builderGraphs = new WeakMap<object, object>()
const resolvedBindings = new WeakMap<object, WeakMap<object, object>>()
const mappers = new WeakMap<
  object,
  Map<unknown, (message: unknown) => unknown>
>()

/** Attaches a completed Block graph to a strict builder, so views rendered
 * with it can embed that Block's children. Platform runtimes call this with
 * their root builder once the root Block is complete. @internal */
export const __bindBlockGraph = <Builder extends object>(
  h: Builder,
  graph: object,
): Builder => {
  const bound = { ...h }
  builderGraphs.set(bound, graph)
  return bound
}

const resolveBinding = (graph: object, declaration: unknown): object => {
  if (!Predicate.isObject(declaration)) {
    throw new Error('[foldkit] embedBlock requires a child Binding.')
  }

  const byDeclaration = resolvedBindings.get(graph) ?? new WeakMap()
  resolvedBindings.set(graph, byDeclaration)
  const cached = byDeclaration.get(declaration)
  if (cached !== undefined) {
    return cached
  }

  const resolve = bindingResolverOf(declaration)
  const binding = canonicalBindingOf(
    resolve === undefined ? declaration : resolve(executionBindingsOf(graph)),
  )
  byDeclaration.set(declaration, binding)
  return binding
}

const mapperFor = (
  binding: object,
  key: unknown,
): ((message: unknown) => unknown) => {
  const byKey = mappers.get(binding) ?? new Map()
  mappers.set(binding, byKey)
  const cached = byKey.get(key)
  if (cached !== undefined) {
    return cached
  }

  const mapper = (message: unknown): unknown =>
    key === unkeyed
      ? Reflect.apply(toParentMessage, undefined, [binding, message])
      : Reflect.apply(toParentMessage, undefined, [binding, key, message])
  byKey.set(key, mapper)
  return mapper
}

const embed = <ChildModel, ChildMessage, ParentMessage, Node, Attribute>(
  h: StrictHtmlBuilder<ParentMessage, Node, Attribute>,
  declaration: unknown,
  key: unknown,
  model: ChildModel,
  view: StrictView<ChildModel, ChildMessage>,
): Node => {
  const graph = builderGraphs.get(h)
  if (graph === undefined) {
    throw new Error(
      '[foldkit] embedBlock requires the builder of a Block program view or of an embedded child Block view.',
    )
  }

  const binding = resolveBinding(graph, declaration)
  const childBuilder = mapMessages(
    h,
    // NOTE: the mapper returns the Binding's child delivery envelope, which
    // belongs to the parent Block's complete dispatch Message.
    /* eslint-disable-next-line @typescript-eslint/consistent-type-assertions */
    mapperFor(binding, key) as (message: ChildMessage) => ParentMessage,
  )
  if (!builderGraphs.has(childBuilder)) {
    builderGraphs.set(childBuilder, runtimeBindingOf(binding).block)
  }

  return view(model, childBuilder)
}

/** Renders a child Block's strict view at this position. Messages from the
 * child view reach the child Block through its Binding, as they do from a web
 * view rendered with `h.block`. The child view can embed its own children.
 * The parent view's Message type covers the parent Block's complete dispatch
 * Messages, including its children's.
 * @experimental */
export const embedBlock = <
  ChildModel,
  ChildMessage,
  ParentMessage,
  Node,
  Attribute,
>(
  h: StrictHtmlBuilder<ParentMessage, Node, Attribute>,
  binding: object,
  model: ChildModel,
  view: StrictView<ChildModel, ChildMessage>,
): Node => embed(h, binding, unkeyed, model, view)

/** Renders one occurrence of a keyed child Block's strict view, such as one
 * row of a keyed array Binding. `key` is the occurrence's decoded key.
 * @experimental */
export const embedKeyedBlock = <
  ChildModel,
  ChildMessage,
  ParentMessage,
  Node,
  Attribute,
>(
  h: StrictHtmlBuilder<ParentMessage, Node, Attribute>,
  binding: object,
  key: unknown,
  model: ChildModel,
  view: StrictView<ChildModel, ChildMessage>,
): Node => embed(h, binding, key, model, view)
