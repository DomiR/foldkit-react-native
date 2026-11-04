import { describe, expect, it } from 'vitest'

import { toTextAreaStyle } from './textArea'

describe('toTextAreaStyle', () => {
  it('computes rows from font size, padding, and border', () => {
    const result = toTextAreaStyle(3, {
      fontSize: 16,
      paddingTop: 4,
      paddingBottom: 6,
      borderWidth: 2,
    })

    expect(result.minHeight).toBeCloseTo(3 * 16 * 1.2 + 4 + 6 + 4)
  })

  it('uses line height over font size', () => {
    const result = toTextAreaStyle(2, { fontSize: 20, lineHeight: 24 })

    expect(result.minHeight).toBeCloseTo(48)
  })

  it('uses vertical and general padding fallbacks', () => {
    expect(toTextAreaStyle(2, { paddingVertical: 3 }).minHeight).toBeCloseTo(
      2 * 14 * 1.2 + 6,
    )
    expect(toTextAreaStyle(2, { padding: 4 }).minHeight).toBeCloseTo(
      2 * 14 * 1.2 + 8,
    )
  })

  it('preserves an explicit height or minimum height', () => {
    const height = { height: 80, padding: 20 }
    const minHeight = { minHeight: 80, padding: 20 }

    expect(toTextAreaStyle(4, height)).toBe(height)
    expect(toTextAreaStyle(4, minHeight)).toBe(minHeight)
  })

  it('preserves the style when rows are undefined', () => {
    const style = { padding: 20 }

    expect(toTextAreaStyle(undefined, style)).toBe(style)
  })

  it('treats percentage padding as zero', () => {
    expect(
      toTextAreaStyle(2, { paddingTop: '10%', paddingBottom: '20%' }).minHeight,
    ).toBeCloseTo(2 * 14 * 1.2)
  })

  it('does not fall through from a percentage top padding', () => {
    expect(
      toTextAreaStyle(2, { paddingTop: '10%', paddingVertical: 5 }).minHeight,
    ).toBeCloseTo(2 * 14 * 1.2 + 5)
  })
})
