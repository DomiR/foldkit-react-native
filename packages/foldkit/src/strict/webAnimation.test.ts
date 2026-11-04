import { Effect } from 'effect'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AnimatedValue, AnimatedValues, Timing } from './animation.js'
import { makeWebAnimationHost } from './webAnimation.js'

const reducedMotionQuery = '(prefers-reduced-motion: reduce)'

const animate = (host: ReturnType<typeof makeWebAnimationHost>) => {
  const key = AnimatedValue.key('progress', 0)
  let notifications = 0
  host.subscribe(() => {
    notifications += 1
  })

  return Effect.runPromise(
    Effect.gen(function* () {
      const values = yield* AnimatedValues
      const result = yield* values.animateTo(
        key,
        100,
        Timing({ durationMs: 0 }),
      )
      return { notifications, result, value: host.read(key) }
    }).pipe(Effect.provide(host.layer)),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('web animation host', () => {
  it('resolves reduced motion at the target without a frame', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === reducedMotionQuery,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }))
    const requestAnimationFrame = vi.fn((_callback: FrameRequestCallback) => 0)
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrame)

    const host = makeWebAnimationHost()
    const { notifications, result, value } = await animate(host)

    expect(result).toStrictEqual({ isFinished: true })
    expect(value).toBe(100)
    expect(notifications).toBe(1)
    expect(requestAnimationFrame).not.toHaveBeenCalled()
    host.dispose()
  })

  it('uses the frame path when reduced motion is not active', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }))
    const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      callback(0)
      return 0
    })
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrame)

    const host = makeWebAnimationHost()
    const { result } = await animate(host)

    expect(result).toStrictEqual({ isFinished: true })
    expect(requestAnimationFrame).toHaveBeenCalled()
    host.dispose()
  })
})
