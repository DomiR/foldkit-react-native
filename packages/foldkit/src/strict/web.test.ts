import { Context, Effect } from 'effect'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { __clearRuntime, __htmlBuilder, __setRuntime } from '../html/index.js'
import { MountTracker } from '../mount/index.js'
import { propsModule } from '../propsModule.js'
import { Dispatch } from '../runtime/index.js'
import {
  attributesModule,
  classModule,
  datasetModule,
  eventListenersModule,
  init,
  styleModule,
  toVNode,
} from '../snabbdom/index.js'
import type { VNode } from '../vdom.js'
import { FadeIn } from './animation.js'
import { toStrictHtml } from './web.js'

const patch = init([
  attributesModule,
  classModule,
  datasetModule,
  eventListenersModule,
  propsModule,
  styleModule,
])

const h = __htmlBuilder<never>()

const renderView = (
  buildView: () => VNode | null,
  onMountStarted: () => void = () => {},
): VNode => {
  const dispatch = Dispatch.of({
    dispatchAsync: () => Effect.void,
    dispatchSync: () => {},
  })
  const runtimeContext = Context.make(Dispatch, dispatch).pipe(
    Context.add(MountTracker, {
      started: onMountStarted,
      ended: () => {},
    }),
  )

  __setRuntime(dispatch.dispatchSync, runtimeContext, undefined)
  try {
    const vnode = buildView()
    if (vnode === null) {
      throw new Error('renderView received a null VNode')
    }
    return vnode
  } finally {
    __clearRuntime()
  }
}

const mountView = (buildView: () => VNode | null): HTMLElement => {
  const patched = patch(
    toVNode(document.createElement('div')),
    renderView(buildView),
  )
  if (!(patched.elm instanceof HTMLElement)) {
    throw new Error('mountView did not produce an HTMLElement')
  }
  return patched.elm
}

const strict = toStrictHtml(h)

afterEach(() => {
  document.body.replaceChildren()
})

describe('strict web accessibility', () => {
  it('renders checked inputs as switches and buttons as native controls', () => {
    const checkedInput = mountView(() => strict.input([strict.Checked(true)]))
    expect(checkedInput.tagName).toBe('INPUT')
    expect(checkedInput.getAttribute('type')).toBe('checkbox')
    expect(checkedInput.getAttribute('role')).toBe('switch')
    expect(checkedInput).toBeInstanceOf(HTMLInputElement)
    if (checkedInput instanceof HTMLInputElement) {
      expect(checkedInput.checked).toBe(true)
    }

    const textInput = mountView(() => strict.input([]))
    expect(textInput.getAttribute('type')).toBe('text')
    expect(textInput.hasAttribute('role')).toBe(false)

    const button = mountView(() => strict.button([strict.Disabled(true)]))
    expect(button.getAttribute('type')).toBe('button')
    expect(button).toBeInstanceOf(HTMLButtonElement)
    if (button instanceof HTMLButtonElement) {
      expect(button.disabled).toBe(true)
    }
  })

  it('renders tab and tab panel semantics without tabindex attributes', () => {
    const container = mountView(() =>
      strict.tabs(
        [],
        [
          strict.tab(
            'first',
            [strict.Title('First')],
            [
              strict.stack(
                [],
                [
                  strict.screen(
                    'screen',
                    [],
                    [strict.h1([], ['First content'])],
                  ),
                ],
              ),
            ],
          ),
          strict.tab(
            'second',
            [strict.Title('Second')],
            [strict.h2([], ['Second'])],
          ),
        ],
      ),
    )

    expect(container.querySelector('[role="tablist"]')).not.toBeNull()
    const tabButtons = container.querySelectorAll('[role="tab"]')
    expect(tabButtons).toHaveLength(2)
    expect(tabButtons.item(0)?.getAttribute('aria-selected')).toBe('true')
    expect(tabButtons.item(1)?.getAttribute('aria-selected')).toBe('false')

    const tabPanel = container.querySelector('[role="tabpanel"]')
    expect(tabPanel?.getAttribute('aria-label')).toBe('First')
    expect(container.querySelectorAll('[tabindex]')).toHaveLength(0)
  })

  it('binds transitioned elements to the reduced motion stylesheet', async () => {
    let mountCount = 0
    const mounted = patch(
      toVNode(document.createElement('div')),
      renderView(
        () =>
          strict.div(
            [],
            [strict.div([strict.Style({ transitionDuration: 100 })])],
          ),
        () => {
          mountCount += 1
        },
      ),
    )
    if (!(mounted.elm instanceof HTMLElement)) {
      throw new Error('mount did not produce an HTMLElement')
    }
    const root = mounted.elm

    await vi.waitFor(() => {
      expect(mountCount).toBe(1)
      const styles = globalThis.Array.from(
        document.head.querySelectorAll('style'),
      )
      expect(
        styles.filter(style =>
          style.textContent?.includes('foldkit-strict-FadeIn'),
        ),
      ).toHaveLength(1)
    })

    const firstMotion = root.querySelector('[data-foldkit-strict-motion]')
    expect(firstMotion).not.toBeNull()

    patch(
      mounted,
      renderView(
        () =>
          strict.div(
            [],
            [
              strict.div([strict.Style({ transitionDuration: 100 })]),
              strict.div([strict.Style({ transitionDuration: 200 })]),
            ],
          ),
        () => {
          mountCount += 1
        },
      ),
    )
    await vi.waitFor(() => {
      expect(mountCount).toBe(2)
      expect(
        root.querySelectorAll('[data-foldkit-strict-motion]'),
      ).toHaveLength(2)
    })
    const styles = globalThis.Array.from(
      document.head.querySelectorAll('style'),
    )
    expect(
      styles.filter(style =>
        style.textContent?.includes('foldkit-strict-FadeIn'),
      ),
    ).toHaveLength(1)
    const strictStyle = styles.find(style =>
      style.textContent?.includes('foldkit-strict-FadeIn'),
    )
    expect(strictStyle?.textContent).toContain('prefers-reduced-motion')
    expect(strictStyle?.textContent).toContain('[data-foldkit-strict-motion]')
    expect(strictStyle?.textContent).toContain('animation: none !important')
    expect(strictStyle?.textContent).toContain(
      'transition-duration: 1ms !important',
    )
    expect(strictStyle?.textContent).toContain(
      'transition-delay: 0s !important',
    )
  })

  it('marks entering elements and applies their keyframe name', () => {
    const container = mountView(() =>
      strict.div([strict.Entering(FadeIn({ durationMs: 200 }))]),
    )
    const motionElement = container.querySelector(
      '[data-foldkit-strict-motion]',
    )
    expect(motionElement).not.toBeNull()
    if (motionElement !== null) {
      expect(motionElement.getAttribute('style')).toContain(
        'animation-name: foldkit-strict-FadeIn',
      )
    }
  })

  it('renders plain elements without a motion binding wrapper', () => {
    const element = mountView(() => strict.div([]))
    expect(element.hasAttribute('data-foldkit-strict-motion')).toBe(false)
    expect(element.style.display).not.toBe('contents')
  })
})
