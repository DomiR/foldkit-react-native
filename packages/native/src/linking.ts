import { Option } from 'effect'
import * as Linking from 'expo-linking'

/** Provides launch and incoming URL events to the native RuntimeHost. The
 * `addUrlListener` method may deliver the launch URL once when the platform
 * reports it only asynchronously. */
export type NativeLinking = Readonly<{
  initialUrl: () => Option.Option<string>
  addUrlListener: (listener: (url: string) => void) => () => void
}>

/** The Expo linking adapter used by native programs by default. */
export const expoLinking: NativeLinking = {
  initialUrl: () => Option.fromNullishOr(Linking.getLinkingURL()),
  addUrlListener: listener => {
    let isRemoved = false
    let isUrlEventDelivered = false

    const subscription = Linking.addEventListener('url', ({ url }) => {
      isUrlEventDelivered = true
      listener(url)
    })

    void Linking.getInitialURL()
      .then(url => {
        const maybeUrl = Option.fromNullishOr(url)
        if (
          Option.isSome(maybeUrl) &&
          !isRemoved &&
          !isUrlEventDelivered &&
          maybeUrl.value !== Linking.getLinkingURL()
        ) {
          listener(maybeUrl.value)
        }
      })
      .catch(() => undefined)

    return () => {
      isRemoved = true
      subscription.remove()
    }
  },
}
