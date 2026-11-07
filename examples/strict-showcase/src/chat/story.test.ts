import { Array, Effect, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { ChatBlock, ChatEntry, Message, Model } from './block'
import { layer } from './layer'

const initialModel = Model.make({
  messages: Array.makeBy(12, index =>
    ChatEntry.make({
      id: `message-${index + 1}`,
      text: `Message ${index + 1}`,
    }),
  ),
  draft: '',
  nextMessageId: 13,
})

describe('update', () => {
  test('init seeds the conversation with an empty draft', () =>
    Effect.runPromise(
      Story.story(
        { block: ChatBlock, layer },
        Story.init(),
        Story.Command.expectNone(),
        Story.model(model => {
          expect(model.messages).toHaveLength(12)
          expect(model.draft).toBe('')
          expect(model.nextMessageId).toBe(13)
        }),
      ),
    ))

  test('UpdatedDraft stores the current draft', () =>
    Effect.runPromise(
      Story.story(
        { block: ChatBlock, layer },
        Story.given(initialModel),
        Story.message(Message.UpdatedDraft({ text: 'Hello there' })),
        Story.model(model => {
          expect(model.draft).toBe('Hello there')
        }),
      ),
    ))

  test('SubmittedDraft appends a trimmed message and clears the draft', () => {
    const modelWithDraft = modifyFields(initialModel, {
      draft: () => '  Hello there  ',
    })

    return Effect.runPromise(
      Story.story(
        { block: ChatBlock, layer },
        Story.given(modelWithDraft),
        Story.message(Message.SubmittedDraft()),
        Story.Command.expectNone(),
        Story.model(model => {
          expect(model.messages).toHaveLength(initialModel.messages.length + 1)
          expect(Option.getOrThrow(Array.last(model.messages))).toStrictEqual({
            id: 'message-13',
            text: 'Hello there',
          })
          expect(model.draft).toBe('')
          expect(model.nextMessageId).toBe(14)
        }),
      ),
    )
  })

  test('SubmittedDraft leaves a whitespace-only draft unchanged', () => {
    const modelWithWhitespace = modifyFields(initialModel, {
      draft: () => '   ',
    })

    return Effect.runPromise(
      Story.story(
        { block: ChatBlock, layer },
        Story.given(modelWithWhitespace),
        Story.message(Message.SubmittedDraft()),
        Story.model(model => {
          expect(model).toStrictEqual(modelWithWhitespace)
        }),
      ),
    )
  })
})
