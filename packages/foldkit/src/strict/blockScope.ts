import { Predicate } from 'effect'

import { bindingResolverOf } from '../block/bindingConnection.js'
import { canonicalBindingOf, runtimeBindingOf } from '../block/composition.js'
import { executionBindingsOf } from '../experimental/constructed/symbolic.js'
import { toParentMessage } from '../test/toParentMessage.js'

/** One Binding step from the root Block to a child occurrence. @experimental */
export type BlockPathStep = Readonly<{ binding: object; key: unknown }>

/** The Block whose view a strict builder renders, and its occurrence path
 * from the root Block. @experimental */
export type BlockScope = Readonly<{
  graph: object
  path: ReadonlyArray<BlockPathStep>
}>

/** A child occurrence entered from a parent scope: its scope, and the mapping
 * from its Messages to the parent's, stamped with the occurrence's current
 * generation. Entering the same occurrence at the same generation returns the
 * same value, so builders derived from it stay referentially stable.
 * @experimental */
export type EnteredBlock = Readonly<{
  scope: BlockScope
  toParentMessage: (message: unknown) => unknown
}>

/** Resolves child Blocks for a host that renders strict views without
 * `h.block`. @experimental */
export type BlockScopes = Readonly<{
  root: BlockScope
  enter: (scope: BlockScope, binding: object, key: unknown) => EnteredBlock
}>

const UNKEYED = Symbol('unkeyed')
const RETIRED_GENERATION = -1

const resolveDeclaration = (graph: object, declaration: object): object => {
  const resolve = bindingResolverOf(declaration)
  return canonicalBindingOf(
    resolve === undefined ? declaration : resolve(executionBindingsOf(graph)),
  )
}

const makeEnvelope = (
  binding: object,
  key: unknown,
  generation: number,
  message: unknown,
): unknown => {
  const envelope: unknown =
    key === UNKEYED
      ? Reflect.apply(toParentMessage, undefined, [binding, message])
      : Reflect.apply(toParentMessage, undefined, [binding, key, message])

  return Predicate.isObject(envelope) ? { ...envelope, generation } : envelope
}

/** Creates the child Block resolver for a completed root Block.
 * `generationAt` reads the live generation of the occurrence at a path; a
 * missing occurrence stamps a generation the runtime never admits.
 * @experimental */
export const makeBlockScopes = (
  root: object,
  generationAt: (path: ReadonlyArray<BlockPathStep>) => number | undefined,
): BlockScopes => {
  const resolved = new WeakMap<object, WeakMap<object, object>>()
  const entered = new WeakMap<
    BlockScope,
    Map<
      object,
      Map<unknown, Readonly<{ generation: number; block: EnteredBlock }>>
    >
  >()

  const resolveBinding = (graph: object, declaration: object): object => {
    const byDeclaration = resolved.get(graph) ?? new WeakMap()
    resolved.set(graph, byDeclaration)
    const cached = byDeclaration.get(declaration)
    if (cached !== undefined) {
      return cached
    }

    const binding = resolveDeclaration(graph, declaration)
    byDeclaration.set(declaration, binding)
    return binding
  }

  const enter = (
    scope: BlockScope,
    declaration: object,
    maybeKey: unknown,
  ): EnteredBlock => {
    const binding = resolveBinding(scope.graph, declaration)
    const key = maybeKey === undefined ? UNKEYED : maybeKey
    const path = [
      ...scope.path,
      { binding, key: key === UNKEYED ? undefined : key },
    ]
    const generation = generationAt(path) ?? RETIRED_GENERATION

    const byBinding = entered.get(scope) ?? new Map()
    entered.set(scope, byBinding)
    const byKey = byBinding.get(binding) ?? new Map()
    byBinding.set(binding, byKey)
    const cached = byKey.get(key)
    if (cached !== undefined && cached.generation === generation) {
      return cached.block
    }

    const child: EnteredBlock = {
      scope: { graph: runtimeBindingOf(binding).block, path },
      toParentMessage: message =>
        makeEnvelope(binding, key, generation, message),
    }
    byKey.set(key, { generation, block: child })
    return child
  }

  return { root: { graph: root, path: [] }, enter }
}
