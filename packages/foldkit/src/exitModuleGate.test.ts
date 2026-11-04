import { expect, it } from 'vitest'

import {
  EXIT_MARKER_ATTRIBUTE,
  EXIT_RUNNER_PROPERTY,
  type ExitRunner,
  exitModule,
} from './exitModule.js'
import { propsModule } from './propsModule.js'
import { type VNode, attributesModule, h, init } from './snabbdom/index.js'

const patch = init([attributesModule, propsModule, exitModule])

const mount = (container: HTMLElement, vnode: VNode): VNode => {
  const placeholder = document.createElement('div')
  container.appendChild(placeholder)
  return patch(placeholder, vnode)
}

const markedData = (runner: ExitRunner) => ({
  attrs: { [EXIT_MARKER_ATTRIBUTE]: '' },
  props: { [EXIT_RUNNER_PROPERTY]: runner },
})

const elementIn = (container: Element, selector: string): Element => {
  const element = container.querySelector(selector)
  if (element === null) {
    throw new Error(`expected ${selector}`)
  }
  return element
}

it('removes marked elements immediately before runners are enabled', () => {
  let isRunnerCalled = false
  const runner: ExitRunner = (_element, _done) => {
    isRunnerCalled = true
    throw new Error('runner should not start')
  }
  const container = document.createElement('div')
  const mounted = mount(container, h('div', markedData(runner), ['content']))

  const mountedElement = elementIn(container, 'div')
  expect(mountedElement).toBe(mounted.elm)

  patch(mounted, h('section'))

  expect(container.querySelector('div')).toBeNull()
  expect(isRunnerCalled).toBe(false)
})
