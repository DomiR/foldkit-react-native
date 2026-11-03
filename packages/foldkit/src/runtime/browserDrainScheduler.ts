import { Option } from 'effect'

import type { DrainScheduler } from './drainScheduler.js'

/** Creates the browser's reusable MessageChannel task boundary. @internal */
export const makeBrowserDrainScheduler = (
  drain: () => void,
): DrainScheduler => {
  let maybeChannel = Option.none<MessageChannel>()

  return {
    schedule: () => {
      const channel = Option.getOrElse(maybeChannel, () => {
        const channel = new MessageChannel()
        channel.port2.onmessage = drain
        return channel
      })
      maybeChannel = Option.some(channel)
      channel.port1.postMessage(null)
    },
    dispose: () => {
      if (Option.isSome(maybeChannel)) {
        maybeChannel.value.port1.close()
        maybeChannel.value.port2.close()
        maybeChannel = Option.none()
      }
    },
  }
}
