import { describe, expect, it } from 'vitest'

import { toCssProperties } from './webStyle.js'

describe('toCssProperties', () => {
  it('drops the Android only includeFontPadding key', () => {
    expect(
      toCssProperties({
        fontSize: 16,
        lineHeight: 20,
        includeFontPadding: false,
      }),
    ).toEqual({ 'font-size': '16px', 'line-height': '20px' })
  })
})
