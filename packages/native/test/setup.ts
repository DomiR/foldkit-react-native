import { afterEach, beforeEach, vi } from 'vitest'

import { FakeWebSocket } from './nativeFixtures'

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }))
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
  FakeWebSocket.sockets = []
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
