import { Array, Option } from 'effect'
import { given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { Message, init, update } from './program'

const initialModel = init().model

describe('update', () => {
  test('UpdatedDraft stores the current draft', () => {
    story(
      update,
      given(initialModel),
      message(Message.UpdatedDraft({ text: 'Hello there' })),
      model(nextModel => {
        expect(nextModel.draft).toBe('Hello there')
      }),
    )
  })

  test('SubmittedDraft appends a trimmed message and clears the draft', () => {
    const modelWithDraft = modifyFields(initialModel, {
      draft: () => '  Hello there  ',
    })

    story(
      update,
      given(modelWithDraft),
      message(Message.SubmittedDraft()),
      model(nextModel => {
        expect(nextModel.messages).toHaveLength(
          initialModel.messages.length + 1,
        )
        expect(Option.getOrThrow(Array.last(nextModel.messages))).toStrictEqual(
          {
            id: 'message-13',
            text: 'Hello there',
          },
        )
        expect(nextModel.draft).toBe('')
        expect(nextModel.nextMessageId).toBe(14)
      }),
    )
  })

  test('SubmittedDraft leaves an empty draft unchanged', () => {
    const modelWithWhitespace = modifyFields(initialModel, {
      draft: () => '   ',
    })

    story(
      update,
      given(modelWithWhitespace),
      message(Message.SubmittedDraft()),
      model(nextModel => {
        expect(nextModel).toBe(modelWithWhitespace)
      }),
    )
  })
})
