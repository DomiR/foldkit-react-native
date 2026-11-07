import { Array, Number, Schema, String } from 'effect'
import { Block } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

// MODEL

export const ChatEntry = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
})
export type ChatEntry = typeof ChatEntry.Type

export const Model = Schema.Struct({
  messages: Schema.Array(ChatEntry),
  draft: Schema.String,
  nextMessageId: Schema.Number,
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  UpdatedDraft: { text: Schema.String },
  SubmittedDraft: {},
})
export type Message = typeof Message.Type

// BLOCK

export const ChatKey = Symbol('Chat')
export const ChatBlock = Block.make('Chat', {
  key: ChatKey,
  InitArgs: Schema.Tuple([]),
  view: { kind: 'Element' },
  Model,
  Message,
})

const { makeComposition, makeFieldsStep, makeStep } = ChatBlock

export const ChatComposition = makeComposition()

// INIT

const INITIAL_MESSAGES: ReadonlyArray<string> = [
  'Good morning. How is everyone?',
  'The new design review starts at ten.',
  'I will bring the notes from yesterday.',
  'Perfect. I added the latest screenshots.',
  'The mobile layout feels much smoother now.',
  'Agreed. The keyboard behavior is the last detail.',
  'I am checking it on a smaller screen.',
  'The message list should keep its place.',
  'That makes the conversation much easier to follow.',
  'I found one more edge case in the composer.',
  'Thanks. I will add it to the review notes.',
  'See you in the meeting shortly.',
]

export const init = ChatComposition.makeInit(() => ({
  model: {
    messages: Array.map(INITIAL_MESSAGES, (text, index) =>
      ChatEntry.make({ id: `message-${index + 1}`, text }),
    ),
    draft: '',
    nextMessageId: INITIAL_MESSAGES.length + 1,
  },
}))

// UPDATE

export const update = ChatComposition.makeUpdate({
  UpdatedDraft: makeFieldsStep.fromMessage(({ text }) => ({
    draft: () => text,
  })),

  SubmittedDraft: makeStep(model => {
    const text = String.trim(model.draft)

    if (String.isEmpty(text)) {
      return { model }
    }

    const nextMessage = ChatEntry.make({
      id: `message-${model.nextMessageId}`,
      text,
    })

    return {
      model: modifyFields(model, {
        messages: Array.append(nextMessage),
        draft: () => '',
        nextMessageId: Number.increment,
      }),
    }
  }),
})
