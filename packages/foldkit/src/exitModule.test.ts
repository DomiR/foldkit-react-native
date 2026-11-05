import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  EXIT_MARKER_ATTRIBUTE,
  EXIT_RUNNER_PROPERTY,
  type ExitRunner,
  beginImmediateExitWindow,
  endImmediateExitWindow,
  exitModule,
  finishPendingExits,
  markExitRunnersInUse,
} from './exitModule.js'
import { propsModule } from './propsModule.js'
import { type VNode, attributesModule, h, init } from './snabbdom/index.js'

const patch = init([attributesModule, propsModule, exitModule])

const mount = (container: HTMLElement, vnode: VNode): VNode => {
  const placeholder = document.createElement('div')
  container.appendChild(placeholder)
  return patch(placeholder, vnode)
}

const markerAttrs = { [EXIT_MARKER_ATTRIBUTE]: '' }

const markedData = (runner: ExitRunner) => ({
  attrs: markerAttrs,
  props: { [EXIT_RUNNER_PROPERTY]: runner },
})

const elementIn = (container: Element, selector: string): Element => {
  const element = container.querySelector(selector)
  if (element === null) {
    throw new Error(`expected ${selector}`)
  }
  return element
}

const textOf = (container: Element): Array<string> =>
  Array.from(container.querySelectorAll('li')).map(
    element => element.textContent ?? '',
  )

const deferredExit = (): Readonly<{
  runner: ExitRunner
  finish: () => void
  elements: Array<Element>
}> => {
  const elements: Array<Element> = []
  let finishNow: (() => void) | undefined
  const runner: ExitRunner = (element, done) => {
    elements.push(element)
    finishNow = done
    return done
  }
  const finish = (): void => {
    if (finishNow === undefined) {
      throw new Error('exit runner has not started')
    }
    finishNow()
  }
  return { runner, finish, elements }
}

describe('exit module', () => {
  beforeEach(() => {
    markExitRunnersInUse()
  })

  afterEach(() => {
    finishPendingExits()
  })

  it('keeps a removed marked element until its runner finishes', () => {
    const exit = deferredExit()
    const container = document.createElement('div')
    const mounted = mount(
      container,
      h('ul', {}, [
        h('li', { key: 'one', ...markedData(exit.runner) }, ['one']),
      ]),
    )

    patch(mounted, h('ul'))

    const ghost = elementIn(container, 'li')
    expect(exit.elements).toStrictEqual([ghost])
    expect(ghost.hasAttribute('inert')).toBe(true)
    expect(ghost.getAttribute('aria-hidden')).toBe('true')

    exit.finish()

    expect(container.querySelector('li')).toBeNull()
  })

  it('delays an unmarked parent when a marked descendant exits', () => {
    const exit = deferredExit()
    const container = document.createElement('main')
    const mounted = mount(
      container,
      h('div', {}, [h('span', markedData(exit.runner), ['content'])]),
    )

    patch(mounted, h('section', {}, ['replacement']))

    const ghost = elementIn(container, 'div')
    expect(ghost.hasAttribute('inert')).toBe(true)
    expect(ghost.textContent).toBe('content')

    exit.finish()

    expect(container.querySelector('div')).toBeNull()
    expect(container.textContent).toBe('replacement')
  })

  it('waits for every marked element in a nested ghost', () => {
    const rootExit = deferredExit()
    const childExit = deferredExit()
    const container = document.createElement('main')
    const mounted = mount(
      container,
      h('div', markedData(rootExit.runner), [
        h('span', markedData(childExit.runner), ['content']),
      ]),
    )

    patch(mounted, h('section'))

    rootExit.finish()
    expect(container.querySelector('div')).not.toBeNull()

    childExit.finish()
    expect(container.querySelector('div')).toBeNull()
  })

  it('keeps a lingering ghost out of live keyed reorders', () => {
    const exit = deferredExit()
    const renderList = (keys: ReadonlyArray<string>): VNode =>
      h(
        'ul',
        {},
        keys.map(key =>
          key === 'b'
            ? h('li', { key, ...markedData(exit.runner) }, [key])
            : h('li', { key }, [key]),
        ),
      )
    const container = document.createElement('div')
    const mounted = mount(container, renderList(['a', 'b', 'c', 'd']))

    const reordered = patch(mounted, renderList(['d', 'c', 'a']))

    const liveItems = Array.from(container.querySelectorAll('li'))
      .filter(element => !element.hasAttribute('inert'))
      .map(element => element.textContent ?? '')
    expect(liveItems).toStrictEqual(['d', 'c', 'a'])
    expect(container.querySelector('li[inert]')).not.toBeNull()

    exit.finish()

    expect(textOf(container)).toStrictEqual(['d', 'c', 'a'])
    expect(reordered.elm).toBe(container.firstElementChild)
  })

  it('lets a same-key live element coexist with its exiting ghost', () => {
    const exit = deferredExit()
    const container = document.createElement('div')
    const mounted = mount(
      container,
      h('ul', {}, [
        h('li', { key: 'item', ...markedData(exit.runner) }, ['old']),
        h('li', { key: 'other' }, ['other']),
      ]),
    )

    const withoutItem = patch(
      mounted,
      h('ul', {}, [h('li', { key: 'other' }, ['other'])]),
    )
    patch(
      withoutItem,
      h('ul', {}, [
        h('li', { key: 'item' }, ['new']),
        h('li', { key: 'other' }, ['other']),
      ]),
    )

    const items = Array.from(container.querySelectorAll('li')).filter(
      element => element.textContent === 'old' || element.textContent === 'new',
    )
    expect(items).toHaveLength(2)
    expect(
      items.filter(element => !element.hasAttribute('inert')),
    ).toHaveLength(1)
    expect(elementIn(container, 'li:not([inert])').textContent).toBe('new')

    exit.finish()

    expect(textOf(container)).toStrictEqual(['new', 'other'])
  })

  it('removes an element immediately during an immediate-exit window', () => {
    const runner: ExitRunner = (_element, _done) => {
      throw new Error('runner should not start')
    }
    const container = document.createElement('div')
    const mounted = mount(container, h('div', markedData(runner), ['content']))

    beginImmediateExitWindow()
    patch(mounted, h('section'))
    endImmediateExitWindow()

    expect(container.querySelector('div')).toBeNull()
  })

  it('finishes all pending exits together', () => {
    const firstExit = deferredExit()
    const secondExit = deferredExit()
    const container = document.createElement('div')
    const mounted = mount(
      container,
      h('ul', {}, [
        h('li', { key: 'first', ...markedData(firstExit.runner) }, ['first']),
        h('li', { key: 'second', ...markedData(secondExit.runner) }, [
          'second',
        ]),
      ]),
    )

    patch(mounted, h('ul'))
    expect(container.querySelectorAll('li')).toHaveLength(2)

    finishPendingExits()

    expect(container.querySelectorAll('li')).toHaveLength(0)
  })

  it('removes a ghost when its finisher does not report done', () => {
    const runner: ExitRunner = (_element, _done) => () => {}
    const container = document.createElement('div')
    const mounted = mount(container, h('div', markedData(runner), ['content']))

    patch(mounted, h('section'))
    expect(container.querySelector('div')).not.toBeNull()

    finishPendingExits()

    expect(container.querySelector('div')).toBeNull()
  })

  it('runs destroy hooks before a marked element waits for its exit', () => {
    const exit = deferredExit()
    const destroy = vi.fn()
    const container = document.createElement('div')
    const mounted = mount(
      container,
      h('div', markedData(exit.runner), [
        h('span', { hook: { destroy } }, ['content']),
      ]),
    )

    patch(mounted, h('section'))

    expect(destroy).toHaveBeenCalledTimes(1)
    expect(container.querySelector('div')).not.toBeNull()

    exit.finish()
    expect(container.querySelector('div')).toBeNull()
  })

  it('removes a ghost when its runner throws', () => {
    let isRunnerCalled = false
    let isInertWhenStarted = false
    const container = document.createElement('div')
    const runner: ExitRunner = (element, _done) => {
      isRunnerCalled = true
      isInertWhenStarted = element.hasAttribute('inert')
      throw new Error('exit failed')
    }
    const mounted = mount(container, h('div', markedData(runner), ['content']))

    expect(() => patch(mounted, h('section'))).not.toThrow()

    expect(isRunnerCalled).toBe(true)
    expect(isInertWhenStarted).toBe(true)
    expect(container.querySelector('div')).toBeNull()
  })
})
