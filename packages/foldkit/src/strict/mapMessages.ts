import { LongPress, Pan, StrictGesture, Swipe, Tap } from './gesture.js'
import type { StrictHtmlBuilder } from './strict.js'

const mapGesture = <Message, ParentMessage>(
  gesture: StrictGesture<Message>,
  toParentMessage: (message: Message) => ParentMessage,
): StrictGesture<ParentMessage> =>
  StrictGesture.match<StrictGesture<ParentMessage>, StrictGesture<Message>>(
    gesture,
    {
      Tap: ({ onTap, ...options }) =>
        Tap({ ...options, onTap: toParentMessage(onTap) }),
      LongPress: ({ onLongPress, ...options }) =>
        LongPress({ ...options, onLongPress: toParentMessage(onLongPress) }),
      Pan: ({ onEnd, ...options }) =>
        Pan({ ...options, onEnd: event => toParentMessage(onEnd(event)) }),
      Swipe: ({ onSwipe, ...options }) =>
        Swipe({ ...options, onSwipe: toParentMessage(onSwipe) }),
    },
  )

const mappedBuilders = new WeakMap<object, WeakMap<Function, object>>()

/** Gives a child strict view a builder that lifts its event and gesture Messages
 * into the parent's Message union. The same parent builder and the same
 * `toParentMessage` function return the same builder, so `createStrictLazy`
 * can reuse nodes built with it. @experimental */
export const mapMessages = <Message, ParentMessage, Node, Attribute>(
  h: StrictHtmlBuilder<ParentMessage, Node, Attribute>,
  toParentMessage: (message: Message) => ParentMessage,
): StrictHtmlBuilder<Message, Node, Attribute> => {
  const builders = mappedBuilders.get(h) ?? new WeakMap<Function, object>()
  mappedBuilders.set(h, builders)
  const cached = builders.get(toParentMessage)
  if (cached !== undefined) {
    // NOTE: the cache is keyed by this exact parent builder and function, so
    // the stored builder has this call's Message, Node, and Attribute types.
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    return cached as StrictHtmlBuilder<Message, Node, Attribute>
  }

  const mapped: StrictHtmlBuilder<Message, Node, Attribute> = {
    ...h,
    OnClick: message => h.OnClick(toParentMessage(message)),
    OnEndReached: message => h.OnEndReached(toParentMessage(message)),
    OnInput: toMessage => h.OnInput(value => toParentMessage(toMessage(value))),
    OnSubmitEditing: message => h.OnSubmitEditing(toParentMessage(message)),
    OnTransitionEnd: message => h.OnTransitionEnd(toParentMessage(message)),
    OnDismissed: toMessage =>
      h.OnDismissed(count => toParentMessage(toMessage(count))),
    OnSelectTab: toMessage =>
      h.OnSelectTab(key => toParentMessage(toMessage(key))),
    Gesture: gesture => h.Gesture(mapGesture(gesture, toParentMessage)),
  }
  builders.set(toParentMessage, mapped)

  return mapped
}
