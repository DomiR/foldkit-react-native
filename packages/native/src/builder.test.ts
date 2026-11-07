import { describe, expect, it, vi } from 'vitest'

import { makeNativeBuilder } from './builder'
import type { NativeBuilder } from './builder'

describe('makeNativeBuilder', () => {
  it('builds textarea attributes', () => {
    const h = makeNativeBuilder()
    const node = h.textarea([
      h.Value('hello'),
      h.Rows(4),
      h.OnInput(() => 'edited'),
    ])

    expect(node).toMatchObject({
      tag: 'textarea',
      attributes: { rows: 4, value: 'hello' },
    })
  })

  it('keys textarea nodes', () => {
    const h = makeNativeBuilder()
    const textarea = h.keyed('textarea')('message', [h.Value('hello')])

    expect(textarea).toMatchObject({ tag: 'textarea', key: 'message' })
  })

  it('marks sticky footers for native layout', () => {
    const h = makeNativeBuilder()
    const footer = h.stickyFooter([], ['Message composer'])

    expect(footer).toMatchObject({
      tag: 'footer',
      attributes: { isStickyFooter: true },
    })
  })
})

describe('lazy', () => {
  const label = (h: NativeBuilder<string>, text: string) => h.p([], [text])

  it('returns the same Lazy node while the view and arguments are unchanged', () => {
    const h = makeNativeBuilder<string>()
    const slot = {}
    const view = vi.fn(label)

    const first = h.lazy(slot, undefined, view, [h, 'First'])
    const second = h.lazy(slot, undefined, view, [h, 'First'])
    const third = h.lazy(slot, undefined, view, [h, 'Second'])

    expect(first).toMatchObject({ _tag: 'Lazy', node: { tag: 'p' } })
    expect(second).toBe(first)
    expect(third).not.toBe(first)
    expect(view).toHaveBeenCalledTimes(2)
  })

  it('misses when the view function changes and caches each key', () => {
    const h = makeNativeBuilder<string>()
    const slot = {}
    const first = h.lazy(slot, 'a', label, [h, 'A'])

    expect(h.lazy(slot, 'b', label, [h, 'A'])).not.toBe(first)
    expect(h.lazy(slot, 'a', label, [h, 'A'])).toBe(first)
    expect(
      h.lazy(
        slot,
        'a',
        (h: NativeBuilder<string>, text: string) => label(h, text),
        [h, 'A'],
      ),
    ).not.toBe(first)
  })
})

describe('ImmediateTabSelection', () => {
  it('records immediate selection on tabs', () => {
    const h = makeNativeBuilder<string>()
    const node = h.tabs(
      [h.ImmediateTabSelection(true), h.SelectedTab('home')],
      [h.tab('home', [], [])],
    )

    expect(node).toMatchObject({
      _tag: 'Tabs',
      attributes: { isTabSelectionImmediate: true, selectedTab: 'home' },
    })
  })
})
