import { describe, expect, it } from 'vitest'

import { brandViewResult } from './brand'
import { makeNativeBuilder } from './builder'

describe('brandViewResult', () => {
  it('stamps the node a Lazy result reuses, once', () => {
    const h = makeNativeBuilder<string>()
    const slot = {}
    const view = () => h.div([])
    const lazy = h.lazy(slot, undefined, view, [])

    brandViewResult(lazy, 'first')
    brandViewResult(h.lazy(slot, undefined, view, []), 'second')

    expect(lazy).toMatchObject({ _tag: 'Lazy', node: { identity: 'first' } })
  })
})
