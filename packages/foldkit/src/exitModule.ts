import { Array, Predicate } from 'effect'

import type { Module, VNode } from './snabbdom/index.js'

/** Property containing the runner used for an element's exit animation. */
export const EXIT_RUNNER_PROPERTY = '__foldkitExitRunner'

/** Attribute marking an element that participates in an exit animation. */
export const EXIT_MARKER_ATTRIBUTE = 'data-foldkit-exit'

/** Starts an element's exit animation and returns a function that finishes it
 *  now. */
export type ExitRunner = (element: Element, done: () => void) => () => void

let isExitRunnerInUse = false
let immediateExitWindowDepth = 0
const pendingExits = new Set<() => void>()

/** Enables exit runner lookup for all later removals. */
export const markExitRunnersInUse = (): void => {
  isExitRunnerInUse = true
}

/** Opens a window in which removals happen without exit animations. */
export const beginImmediateExitWindow = (): void => {
  immediateExitWindowDepth += 1
}

/** Closes an immediate-removal window. */
export const endImmediateExitWindow = (): void => {
  if (immediateExitWindowDepth > 0) {
    immediateExitWindowDepth -= 1
  }
}

/** Finishes every exit animation currently delaying DOM removal. */
export const finishPendingExits = (): void => {
  for (const finishNow of pendingExits) {
    finishNow()
  }
}

const isExitRunner = (value: unknown): value is ExitRunner =>
  Predicate.isFunction(value)

type ExitTarget = Readonly<{
  element: Element
  runner: ExitRunner
}>

const collectExitTargets = (root: Element): Array<ExitTarget> => {
  const targets: Array<ExitTarget> = []

  const addTarget = (element: Element): void => {
    const maybeRunner = Reflect.get(element, EXIT_RUNNER_PROPERTY)
    if (isExitRunner(maybeRunner)) {
      targets.push({ element, runner: maybeRunner })
    }
  }

  if (root.matches(`[${EXIT_MARKER_ATTRIBUTE}]`)) {
    addTarget(root)
  }

  for (const element of root.querySelectorAll(`[${EXIT_MARKER_ATTRIBUTE}]`)) {
    addTarget(element)
  }

  return targets
}

/** Delays removal of marked subtrees until their exit runners finish. */
export const exitModule: Module = {
  remove: (vnode: VNode, removeCallback: () => void): void => {
    if (
      !isExitRunnerInUse ||
      immediateExitWindowDepth > 0 ||
      !(vnode.elm instanceof Element)
    ) {
      removeCallback()
      return
    }

    const root = vnode.elm
    const targets = collectExitTargets(root)
    if (Array.isArrayEmpty(targets)) {
      removeCallback()
      return
    }

    // NOTE: destroy hooks already ran when this remove hook fires, so the
    // ghost is inert and its Mounts have already been released.
    root.setAttribute('inert', '')
    root.setAttribute('aria-hidden', 'true')

    let outstanding = targets.length
    let isRemoved = false

    const complete = (): void => {
      outstanding -= 1
      if (outstanding === 0 && !isRemoved) {
        isRemoved = true
        removeCallback()
      }
    }

    for (const { element, runner } of targets) {
      let isDone = false
      let finishNow: (() => void) | undefined

      const reportDone = (): void => {
        if (isDone) {
          return
        }
        isDone = true
        if (finishNow !== undefined) {
          pendingExits.delete(finishNow)
        }
        complete()
      }

      try {
        const runnerFinishNow = runner(element, reportDone)
        finishNow = (): void => {
          try {
            runnerFinishNow()
          } catch {
            return
          } finally {
            reportDone()
          }
        }
        if (!isDone) {
          pendingExits.add(finishNow)
        }
      } catch {
        reportDone()
      }
    }
  },
}
