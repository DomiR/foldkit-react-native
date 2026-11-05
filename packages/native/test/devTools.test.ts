import { Option } from 'effect'
import { defineMessageUnion } from 'foldkit/message'
import { describe, expect, it, vi } from 'vitest'

import { resolveNativeDevTools } from '../src/devTools'
import { makeNativeHost } from '../src/host'
import { expoLinking } from '../src/linking'

describe('native DevTools options', () => {
  it.each([
    ['ios', '127.0.0.1'],
    ['android', '10.0.2.2'],
    ['windows', '127.0.0.1'],
  ])('uses the default relay on %s', (platform, host) => {
    const resolved = Option.getOrThrow(
      resolveNativeDevTools({}, platform, true),
    )
    expect(resolved.url).toBe(`ws://${host}:9989/__foldkit/devtools-runtime`)
    expect(resolved.metadata).toEqual({
      url: `foldkit-native://${platform}/Foldkit%20Native`,
      title: `Foldkit Native (${platform})`,
    })
    expect(resolved.config).toEqual({ show: 'Development' })
    expect(Option.isNone(resolved.maybeMessageSchema)).toBe(true)
  })

  it('forwards history and Schema options with explicit relay metadata', () => {
    const Message = defineMessageUnion({ ClickedIncrement: {} })
    const maybeResolved = resolveNativeDevTools(
      {
        Message,
        name: 'Counter / preview',
        relayHost: 'localhost',
        relayPort: 12345,
        maxEntries: 200,
        keyframeInterval: 2,
        excludeFromHistory: ['CompletedTick'],
      },
      'android',
      true,
    )
    const resolved = Option.getOrThrow(maybeResolved)
    expect(resolved.url).toBe('ws://localhost:12345/__foldkit/devtools-runtime')
    expect(resolved.metadata.url).toBe(
      'foldkit-native://android/Counter%20%2F%20preview',
    )
    expect(resolved.config).toEqual({
      show: 'Development',
      Message,
      maxEntries: 200,
      keyframeInterval: 2,
      excludeFromHistory: ['CompletedTick'],
    })
    expect(Option.getOrThrow(resolved.maybeMessageSchema)).toBe(Message)
    const host = makeNativeHost(
      expoLinking,
      { isLaunchUrlReplayed: true },
      maybeResolved,
    )
    expect(host.isDevelopment).toBe(false)
    expect(host.isDevToolsDevelopment()).toBe(true)
  })

  it.each([
    '192.168.1.2',
    'example.com',
    '127.0.0.1:9989',
    'localhost.evil',
    '',
  ])('disables an invalid host %s', relayHost => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(
      Option.isNone(resolveNativeDevTools({ relayHost }, 'ios', true)),
    ).toBe(true)
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining('DevTools disabled'),
    )
  })

  it.each([0, -1, 65536, 2.5, Infinity, NaN])(
    'disables an invalid port %s',
    relayPort => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      expect(
        Option.isNone(resolveNativeDevTools({ relayPort }, 'ios', true)),
      ).toBe(true)
      expect(warn).toHaveBeenCalledOnce()
    },
  )

  it.each([1, 65535])('accepts boundary port %s', relayPort => {
    expect(
      Option.isSome(resolveNativeDevTools({ relayPort }, 'ios', true)),
    ).toBe(true)
  })

  it('requires both opt-in and the development global', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal('__DEV__', true)
    expect(Option.isNone(resolveNativeDevTools(undefined, 'ios'))).toBe(true)
    expect(Option.isNone(resolveNativeDevTools(false, 'ios'))).toBe(true)
    expect(Option.isSome(resolveNativeDevTools({}, 'ios'))).toBe(true)
    vi.stubGlobal('__DEV__', false)
    expect(
      Option.isNone(resolveNativeDevTools({ relayHost: 'invalid' }, 'ios')),
    ).toBe(true)
    vi.stubGlobal('__DEV__', undefined)
    expect(Option.isNone(resolveNativeDevTools({}, 'ios'))).toBe(true)
    expect(warn).not.toHaveBeenCalled()
    expect(
      makeNativeHost(expoLinking, {
        isLaunchUrlReplayed: true,
      }).isDevToolsDevelopment(),
    ).toBe(false)
  })
})
