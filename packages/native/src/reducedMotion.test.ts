import { describe, expect, it } from 'vitest'

import { withReducedMotion } from './reducedMotion'

describe('withReducedMotion', () => {
  it('returns the same style when reduced motion is disabled', () => {
    const style = { transitionDuration: 300, opacity: 0.5 }

    expect(withReducedMotion(style, false)).toBe(style)
  })

  it('shortens transitions and preserves other style fields', () => {
    const style = {
      transitionProperty: 'opacity',
      transitionDuration: 300,
      transitionDelay: 100,
      opacity: 0.5,
    } satisfies Parameters<typeof withReducedMotion>[0]

    expect(withReducedMotion(style, true)).toEqual({
      transitionProperty: 'opacity',
      transitionDuration: 1,
      transitionDelay: 0,
      opacity: 0.5,
    })
    expect(style.transitionDuration).toBe(300)
    expect(style.transitionDelay).toBe(100)
  })

  it('returns the same style when there are no transition fields', () => {
    const style = { opacity: 0.5 }

    expect(withReducedMotion(style, true)).toBe(style)
  })
})
