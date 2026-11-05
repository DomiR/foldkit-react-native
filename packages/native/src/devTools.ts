import { Option, type Schema } from 'effect'
import type { DevToolsConfig } from 'foldkit/runtime'
import type { DevToolsRuntimeMetadata } from 'foldkit/runtime-core'

/** Opts a development native program into relay inspection and replay.
 * Supplying the Message Schema also permits validated agent dispatch. */
export type NativeDevToolsConfig<Message> =
  | false
  | Readonly<{
      Message?: Schema.Codec<Message, unknown>
      name?: string
      relayHost?: string
      relayPort?: number
      excludeFromHistory?: ReadonlyArray<string>
      maxEntries?: number
      keyframeInterval?: number
    }>

/** Validated native transport settings and the core recording configuration. @internal */
export type ResolvedNativeDevTools<Message> = Readonly<{
  config: DevToolsConfig
  maybeMessageSchema: Option.Option<Schema.Codec<Message, unknown>>
  metadata: DevToolsRuntimeMetadata
  url: string
}>

const DEFAULT_RELAY_PORT = 9989
const MIN_RELAY_PORT = 1
const MAX_RELAY_PORT = 65535

/** Resolves native opt-in before creating a store or transport. @internal */
export const resolveNativeDevTools = <Message>(
  devTools: NativeDevToolsConfig<Message> | undefined,
  platform: string,
  isDevelopment: boolean = typeof __DEV__ !== 'undefined' && __DEV__,
): Option.Option<ResolvedNativeDevTools<Message>> => {
  if (!isDevelopment || devTools === undefined || devTools === false) {
    return Option.none()
  }

  const {
    Message,
    excludeFromHistory,
    maxEntries,
    keyframeInterval,
    name = 'Foldkit Native',
    relayHost = platform === 'android' ? '10.0.2.2' : '127.0.0.1',
    relayPort = DEFAULT_RELAY_PORT,
  } = devTools
  const isAllowedHost =
    relayHost === '127.0.0.1' ||
    relayHost === 'localhost' ||
    relayHost === '10.0.2.2'
  const isAllowedPort =
    Number.isInteger(relayPort) &&
    relayPort >= MIN_RELAY_PORT &&
    relayPort <= MAX_RELAY_PORT

  if (!isAllowedHost || !isAllowedPort) {
    console.warn(
      '[foldkit/native] DevTools disabled: relayHost must be 127.0.0.1, localhost, or 10.0.2.2, and relayPort must be an integer from 1 to 65535.',
    )
    return Option.none()
  }

  return Option.some({
    config: {
      show: 'Development',
      ...(Message !== undefined && { Message }),
      ...(excludeFromHistory !== undefined && { excludeFromHistory }),
      ...(maxEntries !== undefined && { maxEntries }),
      ...(keyframeInterval !== undefined && { keyframeInterval }),
    },
    maybeMessageSchema: Option.fromNullishOr(Message),
    metadata: {
      url: `foldkit-native://${platform}/${encodeURIComponent(name)}`,
      title: `${name} (${platform})`,
    },
    url: `ws://${relayHost}:${relayPort}/__foldkit/devtools-runtime`,
  })
}
