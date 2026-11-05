import { Array, Option, Predicate } from 'effect'
import { describe, expect, it, vi } from 'vitest'

import { makeNativeBuilder } from './builder'
import type { NativeChild } from './node'
import { liftStickyFooter } from './stickyFooter'

const getElementOrThrow = (
  children: ReadonlyArray<NativeChild<string>>,
  index: number,
) => {
  const child = Option.getOrThrow(Array.get(children, index))

  if (child === null || Predicate.isString(child) || child._tag !== 'Element') {
    throw new Error('Expected a native Element')
  }

  return child
}

describe('liftStickyFooter', () => {
  it('lifts a nested footer and preserves ancestor fields and untouched siblings', () => {
    const h = makeNativeBuilder<string>()
    const leading = h.keyed('p')('leading', [], ['Leading'])
    const before = h.keyed('input')('draft', [h.Value('Draft')])
    const after = h.keyed('p')('after', [], ['After'])
    const trailing = h.keyed('p')('trailing', [], ['Trailing'])
    const footer = {
      ...h.stickyFooter([h.Key('composer'), h.OnClick('ClickedSend')]),
      identity: 'composerView',
    }
    const nestedChildren = Object.freeze([before, footer, after])
    const nested = {
      ...h.keyed('div')('nested', [h.Style({ gap: 8 })], nestedChildren),
      identity: 'nestedView',
    }
    const outerChildren = Object.freeze(['Title', nested, null])
    const outer = {
      ...h.keyed('div')('outer', [h.Style({ padding: 16 })], outerChildren),
      identity: 'outerView',
    }
    const children = Object.freeze([leading, outer, trailing])

    const footerLift = Option.getOrThrow(liftStickyFooter(children))
    const nextOuter = getElementOrThrow(footerLift.children, 1)
    const nextNested = getElementOrThrow(nextOuter.children, 1)

    expect(footerLift.footer).toBe(footer)
    expect(footerLift.children).not.toBe(children)
    expect(Option.getOrThrow(Array.head(footerLift.children))).toBe(leading)
    expect(Option.getOrThrow(Array.last(footerLift.children))).toBe(trailing)
    expect(nextOuter).toEqual({
      ...outer,
      children: ['Title', nextNested, null],
    })
    expect(nextNested).toEqual({ ...nested, children: [before, after] })
    expect(Option.getOrThrow(Array.head(nextNested.children))).toBe(before)
    expect(Option.getOrThrow(Array.last(nextNested.children))).toBe(after)
    expect(outer).toMatchObject({ children: outerChildren })
    expect(nested).toMatchObject({ children: nestedChildren })
    expect(nestedChildren).toEqual([before, footer, after])
  })

  it('returns none when the tree contains no marked footer', () => {
    const h = makeNativeBuilder<string>()
    const children = [
      null,
      'Text',
      h.empty,
      h.div([], [h.footer([], ['Ordinary footer'])]),
    ]

    expect(liftStickyFooter(children)).toEqual(Option.none())
    expect(liftStickyFooter([])).toEqual(Option.none())
  })

  it('searches depth first and leaves later footers in place', () => {
    const h = makeNativeBuilder<string>()
    const first = h.stickyFooter([h.Key('first')])
    const second = h.stickyFooter([h.Key('second')])
    const last = h.stickyFooter([h.Key('last')])
    const nested = h.keyed('div')('nested', [], [first, second])
    const children = [h.div([], [nested]), last]

    const footerLift = Option.getOrThrow(liftStickyFooter(children))
    const nextOuter = getElementOrThrow(footerLift.children, 0)
    const nextNested = getElementOrThrow(nextOuter.children, 0)

    expect(footerLift.footer).toBe(first)
    expect(nextNested.children).toEqual([second])
    expect(Option.getOrThrow(Array.head(nextNested.children))).toBe(second)
    expect(Option.getOrThrow(Array.last(footerLift.children))).toBe(last)
  })

  it('lifts a marked parent before searching its children', () => {
    const h = makeNativeBuilder<string>()
    const nested = h.stickyFooter([h.Key('nested')])
    const footer = h.stickyFooter([h.Key('outer')], [nested])

    const footerLift = Option.getOrThrow(liftStickyFooter([footer]))

    expect(footerLift.footer).toBe(footer)
    expect(footerLift.children).toEqual([])
  })

  it('does not render or search List rows', () => {
    const h = makeNativeBuilder<string>()
    const rowFooter = h.stickyFooter([h.Key('row-footer')])
    const renderRow = vi.fn(() => rowFooter)
    const list = h.list([], {
      items: ['row'],
      key: row => row,
      view: renderRow,
    })
    const footer = h.stickyFooter([h.Key('composer')])

    expect(liftStickyFooter([list])).toEqual(Option.none())

    const footerLift = Option.getOrThrow(liftStickyFooter([list, footer]))

    expect(footerLift.footer).toBe(footer)
    expect(Option.getOrThrow(Array.head(footerLift.children))).toBe(list)
    expect(renderRow).not.toHaveBeenCalled()
  })

  it('does not enter Stack screens or Tabs', () => {
    const h = makeNativeBuilder<string>()
    const screenFooter = h.stickyFooter([h.Key('screen-footer')])
    const tabFooter = h.stickyFooter([h.Key('tab-footer')])
    const stack = h.stack([], [h.screen('screen', [], [screenFooter])])
    const tabs = h.tabs([], [h.tab('tab', [], [tabFooter])])
    const footer = h.stickyFooter([h.Key('composer')])

    expect(liftStickyFooter([stack, tabs])).toEqual(Option.none())

    const footerLift = Option.getOrThrow(
      liftStickyFooter([stack, tabs, footer]),
    )

    expect(footerLift.footer).toBe(footer)
    expect(Option.getOrThrow(Array.head(footerLift.children))).toBe(stack)
    expect(Option.getOrThrow(Array.last(footerLift.children))).toBe(tabs)
  })
})
