import { describe, expect, it } from 'vitest'

import { makeNativeBuilder } from './builder'

describe('makeNativeBuilder', () => {
  it('builds textarea attributes and revisions', () => {
    const h = makeNativeBuilder(() => 7)
    const node = h.textarea([
      h.Value('hello'),
      h.Rows(4),
      h.OnInput(() => 'edited'),
    ])

    expect(node).toMatchObject({
      tag: 'textarea',
      inputRevision: 7,
      attributes: { rows: 4, value: 'hello' },
    })
  })

  it('keys textarea nodes and stamps only text controls', () => {
    const h = makeNativeBuilder(() => 7)
    const textarea = h.keyed('textarea')('message', [h.Value('hello')])
    const input = h.input([h.Value('hello')])
    const div = h.div([])

    expect(textarea).toMatchObject({ tag: 'textarea', key: 'message' })
    expect(input).toMatchObject({ tag: 'input', inputRevision: 7 })
    expect(div).not.toHaveProperty('inputRevision')
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
