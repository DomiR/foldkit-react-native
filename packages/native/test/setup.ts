import { afterEach, beforeEach, vi } from 'vitest'

import { FakeWebSocket } from './nativeFixtures'

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }))
vi.mock('expo-linking', () => ({
  getLinkingURL: vi.fn(() => null),
  getInitialURL: vi.fn(async () => null),
  addEventListener: vi.fn(() => ({ remove: vi.fn() })),
}))
vi.mock('react-native-reanimated', () => ({
  Easing: { linear: (value: number) => value },
  cancelAnimation: vi.fn(),
  makeMutable: vi.fn((value: number) => ({ value })),
  withSpring: vi.fn(),
  withTiming: vi.fn(),
}))
vi.mock('react-native-worklets', () => ({
  createWorkletRuntime: vi.fn(),
  runOnRuntimeAsync: vi.fn(),
  scheduleOnRN: vi.fn(),
  scheduleOnUI: vi.fn(),
}))

beforeEach(() => {
  vi.stubGlobal('__DEV__', false)
  FakeWebSocket.sockets = []
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
