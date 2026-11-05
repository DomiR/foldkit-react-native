import { Function, Option } from 'effect'

import type { NativeAnimationHost } from './animationHost'

export type PreservedProgram = Readonly<{
  animationHost: NativeAnimationHost
  readEncodedModel: () => Option.Option<unknown>
  dispose: () => void
}>

type PreservedProgramEntry = {
  program: PreservedProgram
  isCurrentTick: boolean
}

const registryKey = Symbol.for('foldkit.native.preservedPrograms')

const getRegistry = (): Map<string, PreservedProgramEntry> => {
  const maybeRegistry = Reflect.get(globalThis, registryKey)
  if (maybeRegistry instanceof Map) {
    return maybeRegistry
  }

  const registry = new Map<string, PreservedProgramEntry>()
  Reflect.set(globalThis, registryKey, registry)
  return registry
}

export const isDevelopment = (): boolean =>
  typeof __DEV__ !== 'undefined' && __DEV__

export const takeOverProgram = (
  id: string,
  animationHost: NativeAnimationHost,
): Option.Option<unknown> => {
  const registry = getRegistry()
  const maybeEntry = Option.fromNullishOr(registry.get(id))

  if (Option.isNone(maybeEntry)) {
    return Option.none()
  }

  const { program, isCurrentTick } = maybeEntry.value
  if (isCurrentTick) {
    console.warn(
      `[foldkit/native] Two programs share the id "${id}". Pass a distinct id to each makeNativeProgram call to keep their Models across Fast Refresh.`,
    )
    return Option.none()
  }

  if (program.animationHost === animationHost) {
    throw new Error(
      `[foldkit/native] The previous program for "${id}" shares its animation host with the new program. The previous program would dispose the shared animation host. Create the host with makeNativeAnimationHost in the same module as makeNativeProgram, or omit animationHost.`,
    )
  }

  const maybeModel = program.readEncodedModel()
  registry.delete(id)
  program.dispose()
  return maybeModel
}

export const registerProgram = (
  id: string,
  program: PreservedProgram,
): (() => void) => {
  const registry = getRegistry()
  const maybeExistingEntry = Option.fromNullishOr(registry.get(id))

  if (
    Option.isSome(maybeExistingEntry) &&
    maybeExistingEntry.value.isCurrentTick
  ) {
    return Function.constVoid
  }

  const entry: PreservedProgramEntry = {
    program,
    isCurrentTick: true,
  }
  registry.set(id, entry)

  setTimeout(() => {
    if (registry.get(id) === entry) {
      entry.isCurrentTick = false
    }
  }, 0)

  return () => {
    if (registry.get(id) === entry) {
      registry.delete(id)
    }
  }
}
