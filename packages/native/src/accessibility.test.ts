import { describe, expect, it } from 'vitest'

import { toAccessibilityProps } from './accessibility'

describe('toAccessibilityProps', () => {
  it('reports a disabled button', () => {
    expect(toAccessibilityProps('button', { isDisabled: true })).toEqual({
      accessibilityRole: 'button',
      accessibilityState: { disabled: true },
    })
  })

  it('reports an enabled button', () => {
    expect(toAccessibilityProps('button', {})).toEqual({
      accessibilityRole: 'button',
      accessibilityState: { disabled: false },
    })
  })

  it('reports a checked switch with its label', () => {
    expect(
      toAccessibilityProps('input', {
        isChecked: true,
        ariaLabel: 'Notifications',
      }),
    ).toEqual({
      accessibilityRole: 'switch',
      accessibilityLabel: 'Notifications',
      accessibilityState: { checked: true, disabled: false },
    })
  })

  it('reports a disabled text input with its label and no role', () => {
    expect(
      toAccessibilityProps('input', {
        ariaLabel: 'Username',
        isDisabled: true,
      }),
    ).toEqual({
      accessibilityLabel: 'Username',
      accessibilityState: { disabled: true },
    })
  })

  it('announces pressable paragraphs as buttons', () => {
    expect(toAccessibilityProps('p', { onClick: 'ClickedParagraph' })).toEqual({
      accessibilityRole: 'button',
      accessibilityState: { disabled: false },
    })
  })

  it('omits the role for plain paragraphs', () => {
    expect(toAccessibilityProps('p', {})).toEqual({})
  })

  it('announces headings as headers', () => {
    expect(toAccessibilityProps('h2', {})).toEqual({
      accessibilityRole: 'header',
    })
  })

  it('omits the role and state for plain containers', () => {
    expect(toAccessibilityProps('div', {})).toEqual({})
  })

  it('uses image alternative text as the label', () => {
    expect(toAccessibilityProps('img', { alt: 'Mountain landscape' })).toEqual({
      accessibilityRole: 'image',
      accessibilityLabel: 'Mountain landscape',
    })
  })
})
