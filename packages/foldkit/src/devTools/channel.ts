import type { DevToolsEnvelope } from './protocol.js'

/** Runtime metadata announced with each DevTools channel connection. */
export type DevToolsRuntimeMetadata = Readonly<{
  url: string
  title: string
}>

/** Lifecycle callbacks for a transport used by the DevTools bridge. */
export type DevToolsChannelCallbacks = Readonly<{
  opened: () => void
  received: (envelope: DevToolsEnvelope) => void
  disposed: () => void
}>

/** Transport contract used by the portable DevTools bridge. */
export type DevToolsChannel = Readonly<{
  send: (envelope: DevToolsEnvelope) => void
  subscribe: (callbacks: DevToolsChannelCallbacks) => () => void
}>
