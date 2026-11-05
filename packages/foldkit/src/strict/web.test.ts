import { Context, Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { type Html, type HtmlBuilder, __htmlBuilder } from '../html/index.js'
import {
  clearRuntime,
  setRuntime,
  type DispatchSync,
} from '../html/runtimeSingleton.js'
import { defineMessageUnion } from '../message/index.js'
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
import { mapMessages } from './mapMessages.js'
import { toStrictHtml } from './web.js'

const patch = init([
  attributesModule,
  classModule,
  datasetModule,
  eventListenersModule,
  propsModule,
  styleModule,
])

const ChildMessage = defineMessageUnion({ SubmittedChild: {} })
type ChildMessage = typeof ChildMessage.Type

const Message = defineMessageUnion({ Submitted: {}, SubmittedChild: {} })
type Message = typeof Message.Type

const h = __htmlBuilder<Message>()
const strict = toStrictHtml(h)
let dispatched: Array<unknown>

const renderView = (
  buildView: () => Html,
  onMountStarted: () => void = () => {},
): VNode => {
  const dispatchSync: DispatchSync = message => {
    dispatched.push(message)
  }
  const dispatch = Dispatch.of({
    dispatchAsync: () => Effect.void,
    dispatchSync,
  })
  const context = Context.make(Dispatch, dispatch).pipe(
    Context.add(MountTracker, { started: onMountStarted, ended: () => {} }),
  )

  setRuntime(dispatchSync, context)

  try {
    const vnode = buildView()

    if (vnode === null) {
      throw new Error('renderView received a null VNode')
    }

    return vnode
  } finally {
    clearRuntime()
  }
}

const render = (build: (h: HtmlBuilder<Message>) => Html): HTMLElement => {
  const result = patch(
    toVNode(document.createElement('div')),
    renderView(() => build(h)),
  )

  if (!(result.elm instanceof HTMLElement)) {
    throw new Error('expected rendered HTMLElement')
  }

  return result.elm
}

const textareaOf = (element: Element): HTMLTextAreaElement => {
  if (!(element instanceof HTMLTextAreaElement)) {
    throw new Error('expected an HTMLTextAreaElement')
  }
  return element
}

beforeEach(() => {
  dispatched = []
})

afterEach(() => {
  document.body.replaceChildren()
})

describe('strict textarea', () => {
  it('renders controlled textarea values, rows, and defaults', () => {
    const element = render(h => {
      const strict = toStrictHtml(h)
      return strict.textarea([strict.Value('message'), strict.Rows(4)])
    })
    const textarea = textareaOf(element)

    expect(element.tagName).toBe('TEXTAREA')
    expect(textarea.value).toBe('message')
    expect(element.getAttribute('rows')).toBe('4')
    expect(element.getAttribute('type')).toBeNull()
    expect(textarea.style.resize).toBe('none')
  })

  it('does not prevent or dispatch textarea Enter', () => {
    const element = render(h => {
      const strict = toStrictHtml(h)
      return strict.textarea([
        strict.Value('message'),
        strict.OnSubmitEditing(Message.Submitted()),
      ])
    })
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    })

    document.body.appendChild(element)
    try {
      element.dispatchEvent(event)
    } finally {
      element.remove()
    }

    expect(event.defaultPrevented).toBe(false)
    expect(dispatched).toEqual([])
  })

  it('prevents default and dispatches on input Enter', () => {
    const element = render(h => {
      const strict = toStrictHtml(h)
      return strict.input([strict.OnSubmitEditing(Message.Submitted())])
    })
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    })

    document.body.appendChild(element)
    try {
      element.dispatchEvent(event)
    } finally {
      element.remove()
    }

    expect(event.defaultPrevented).toBe(true)
    expect(dispatched).toEqual([Message.Submitted()])
  })

  it('ignores Enter on a mapped textarea', () => {
    const element = render(h => {
      const strict = toStrictHtml(h)
      const child = mapMessages(strict, (_message: ChildMessage) =>
        Message.SubmittedChild(),
      )
      return child.textarea([
        child.Value('hello'),
        child.OnSubmitEditing(ChildMessage.SubmittedChild()),
      ])
    })
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    })

    document.body.appendChild(element)
    try {
      element.dispatchEvent(event)
    } finally {
      element.remove()
    }

    expect(event.defaultPrevented).toBe(false)
    expect(dispatched).toEqual([])
  })

  it('renders a bound textarea inside its wrapper', () => {
    const element = render(h => {
      const strict = toStrictHtml(h)
      return strict.textarea([
        strict.Value('hello'),
        strict.Entering(FadeIn({})),
      ])
    })
    const textarea = element.querySelector('textarea')

    if (!(element instanceof HTMLElement)) {
      throw new Error('expected an HTMLElement wrapper')
    }

    if (!(textarea instanceof HTMLTextAreaElement)) {
      throw new Error('expected a textarea inside the bound wrapper')
    }

    expect(element.tagName).toBe('DIV')
    expect(element.style.display).toBe('contents')
    expect(textarea.value).toBe('hello')
  })

  it('renders a keyed textarea', () => {
    const element = render(h => {
      const strict = toStrictHtml(h)
      return strict.keyed('textarea')('message', [strict.Value('hello')])
    })

    expect(element.tagName).toBe('TEXTAREA')
  })
})

describe('strict web accessibility', () => {
  it('renders checked inputs as switches and buttons as native controls', () => {
    const checkedInput = render(() => strict.input([strict.Checked(true)]))
    expect(checkedInput.tagName).toBe('INPUT')
    expect(checkedInput.getAttribute('type')).toBe('checkbox')
    expect(checkedInput.getAttribute('role')).toBe('switch')
    expect(checkedInput).toBeInstanceOf(HTMLInputElement)
    if (checkedInput instanceof HTMLInputElement) {
      expect(checkedInput.checked).toBe(true)
    }

    const textInput = render(() => strict.input([]))
    expect(textInput.getAttribute('type')).toBe('text')
    expect(textInput.hasAttribute('role')).toBe(false)

    const button = render(() => strict.button([strict.Disabled(true)]))
    expect(button.getAttribute('type')).toBe('button')
    expect(button).toBeInstanceOf(HTMLButtonElement)
    if (button instanceof HTMLButtonElement) {
      expect(button.disabled).toBe(true)
    }
  })

  it('renders tab and tab panel semantics without tabindex attributes', () => {
    const container = render(() =>
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
    const container = render(() =>
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
    const element = render(() => strict.div([]))
    expect(element.hasAttribute('data-foldkit-strict-motion')).toBe(false)
    expect(element.style.display).not.toBe('contents')
  })
})

describe('strict footer elements', () => {
  it('renders stickyFooter as a sticky footer with inherited background', () => {
    const element = render(() => strict.stickyFooter([], ['Message composer']))

    expect(element.tagName).toBe('FOOTER')
    expect(element.style.position).toBe('sticky')
    expect(element.style.bottom).toBe('0px')
    expect(element.style.zIndex).toBe('1')
    expect(element.style.backgroundColor).toBe('inherit')
  })

  it('renders footer as a plain footer without sticky positioning', () => {
    const element = render(() => strict.footer([], ['Footer content']))

    expect(element.tagName).toBe('FOOTER')
    expect(element.style.position).toBe('relative')
    expect(element.style.bottom).toBe('')
    expect(element.style.zIndex).toBe('')
  })
})
