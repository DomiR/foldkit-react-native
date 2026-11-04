import { Array, Effect, Fiber, Schema } from 'effect'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { __htmlBuilder as html } from '../html/index.js'
import { defineMessageUnion } from '../message/index.js'
import { makeElement } from '../runtime/makeElement.js'
import { modifyFields } from '../struct/index.js'
import type * as Update from '../update/index.js'
import { FadeIn, FadeOut } from './animation.js'
import { toStrictHtml } from './web.js'

const EXIT_DURATION_MS = 40
const RENDER_POLL_MS = 1
const RENDER_TIMEOUT_MS = 1000

const Message = defineMessageUnion({
  ClickedRemoveItem: { id: Schema.String },
})
type Message = typeof Message.Type

const Model = Schema.Struct({ itemIds: Schema.Array(Schema.String) })
type Model = typeof Model.Type

const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message>>(message, {
    ClickedRemoveItem: ({ id }) => ({
      model: modifyFields(model, {
        itemIds: Array.filter(itemId => itemId !== id),
      }),
    }),
  })

const h = toStrictHtml(html<Message>())

const view = (model: Model) =>
  h.ul(
    [],
    Array.map(model.itemIds, id =>
      h.keyed('li')(
        id,
        [
          h.AriaLabel(id),
          h.Entering(FadeIn({ durationMs: EXIT_DURATION_MS })),
          h.Exiting(FadeOut({ durationMs: EXIT_DURATION_MS })),
        ],
        [
          h.button(
            [h.OnClick(Message.ClickedRemoveItem({ id }))],
            [`Remove ${id}`],
          ),
        ],
      ),
    ),
  )

const waitForRender = (assertion: () => void): Promise<void> =>
  vi.waitFor(assertion, {
    interval: RENDER_POLL_MS,
    timeout: RENDER_TIMEOUT_MS,
  })

const requireItem = (id: string): HTMLElement => {
  const element = document.querySelector(`li[aria-label="${id}"]`)

  if (!(element instanceof HTMLElement)) {
    throw new Error(`Expected item ${id}`)
  }

  return element
}

const removeItem = (element: HTMLElement): void => {
  const button = element.querySelector('button')

  if (!(button instanceof HTMLElement)) {
    throw new Error('Expected a removal button')
  }

  button.click()
}

const expectGhost = (element: HTMLElement): void => {
  expect(element.isConnected).toBe(true)
  expect(element.closest('[inert]')).not.toBeNull()
  expect(element.closest('[aria-hidden="true"]')).not.toBeNull()
  expect(element.style.animationName).toBe('foldkit-strict-FadeOut')
}

const withRuntime = async (check: () => Promise<void>): Promise<void> => {
  const container = document.createElement('div')
  container.id = 'app'
  document.body.appendChild(container)
  const addListener = vi.spyOn(HTMLElement.prototype, 'addEventListener')
  const runtime = makeElement({
    Model,
    init: () => ({ model: Model.make({ itemIds: ['first', 'second'] }) }),
    update,
    view,
    container,
    devTools: false,
  })
  const runtimeFiber = Effect.runFork(runtime.start())

  try {
    await waitForRender(() => {
      expect(requireItem('first').isConnected).toBe(true)
      expect(requireItem('second').isConnected).toBe(true)
      expect(
        addListener.mock.calls.filter(([name]) => name === 'transitionend'),
      ).toHaveLength(2)
    })

    await check()
  } finally {
    await Effect.runPromise(Fiber.interrupt(runtimeFiber))
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('strict web exit animations', () => {
  it('keeps an inert ghost with exit keyframes until the fallback deadline', async () => {
    await withRuntime(async () => {
      const item = requireItem('first')
      removeItem(item)

      await waitForRender(() => expectGhost(item))
      expect(item.style.animationDuration).toBe(`${EXIT_DURATION_MS}ms`)
      expect(item.style.animationFillMode).toBe('forwards')
      expect(item.style.animationDelay).toBe('0ms')
      expect(item.style.animationIterationCount).toBe('1')

      await waitForRender(() => expect(item.isConnected).toBe(false))
    })
  })

  it('finishes on the target animationend and ignores a child animationend', async () => {
    await withRuntime(async () => {
      const item = requireItem('first')
      removeItem(item)

      await waitForRender(() => expectGhost(item))
      item
        .querySelector('button')
        ?.dispatchEvent(new Event('animationend', { bubbles: true }))
      expectGhost(item)

      item.dispatchEvent(new Event('animationend'))
      expect(item.isConnected).toBe(false)

      expect(requireItem('second').isConnected).toBe(true)
    })
  })

  it('removes immediately when reduced motion is enabled', async () => {
    await withRuntime(async () => {
      const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
      Object.defineProperty(mediaQuery, 'matches', { value: true })
      vi.spyOn(window, 'matchMedia').mockReturnValue(mediaQuery)

      const first = requireItem('first')
      const second = requireItem('second')
      removeItem(first)

      await waitForRender(() => {
        expect(first.isConnected).toBe(false)
        expect(requireItem('second')).toBe(second)
        expect(second.isConnected).toBe(true)
      })
      expect(first.style.animationName).toBe('foldkit-strict-FadeIn')
    })
  })

  it('releases the binding Mount while its exit ghost is connected', async () => {
    await withRuntime(async () => {
      const item = requireItem('first')
      const removeListener = vi.spyOn(item, 'removeEventListener')
      removeItem(item)

      await waitForRender(() => {
        expect(removeListener).toHaveBeenCalledWith(
          'transitionend',
          expect.any(Function),
        )
        expectGhost(item)
      })

      item.dispatchEvent(new Event('animationend'))
      expect(item.isConnected).toBe(false)
    })
  })
})
