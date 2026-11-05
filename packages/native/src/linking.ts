import { Option } from 'effect'
import * as Linking from 'expo-linking'

/** Provides launch and incoming URL events to the native RuntimeHost. When
 * `isLaunchUrlReplayed` is true, `addUrlListener` may deliver the launch URL
 * once when the platform reports it only asynchronously. When false, it
 * subscribes only to incoming URL events, preserving restored navigation. */
export type NativeLinking = Readonly<{
  initialUrl: () => Option.Option<string>
  addUrlListener: (
    listener: (url: string) => void,
    options: Readonly<{ isLaunchUrlReplayed: boolean }>,
  ) => () => void
}>

/** The Expo linking adapter used by native programs by default. */
export const expoLinking: NativeLinking = {
  initialUrl: () => Option.fromNullishOr(Linking.getLinkingURL()),
  addUrlListener: (listener, { isLaunchUrlReplayed }) => {
    let isRemoved = false
    let isUrlEventDelivered = false

    const subscription = Linking.addEventListener('url', ({ url }) => {
      isUrlEventDelivered = true
      listener(url)
    })

    if (isLaunchUrlReplayed) {
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
    }

    return () => {
      isRemoved = true
      subscription.remove()
    }
  },
}
