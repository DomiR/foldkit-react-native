import { Array } from 'effect'
import * as FieldValidation from 'foldkit/fieldValidation'
import type { Field } from 'foldkit/fieldValidation'
import type { StrictStyle, StrictView } from 'foldkit/strict'

import { Message, type Model, Submission, isFormValid } from './program'

const inputStyle: StrictStyle = {
  backgroundColor: '#ffffff',
  color: '#182c25',
  borderWidth: 1,
  borderColor: '#acbab2',
  borderRadius: 8,
  paddingHorizontal: 12,
  paddingVertical: 12,
  fontSize: 16,
}

export const strictView: StrictView<Model, Message> = (model, h) => {
  const fieldView = (
    label: string,
    field: Field<string>,
    toMessage: (value: string) => Message,
  ) =>
    h.div(
      [h.Style({ gap: 8 })],
      [
        h.label(
          [h.Style({ color: '#182c25', fontSize: 16, fontWeight: 'bold' })],
          [label],
        ),
        h.input([
          h.Style({
            ...inputStyle,
            borderColor: field._tag === 'Invalid' ? '#aa3434' : '#acbab2',
          }),
          h.AriaLabel(label),
          h.Value(field.value),
          h.OnInput(toMessage),
          h.OnSubmitEditing(Message.ClickedFormSubmit()),
        ]),
        FieldValidation.match(field, {
          onNotValidated: () => h.empty,
          onValidating: () =>
            h.p([h.Style({ color: '#627a6c' })], ['Checking…']),
          onValid: () => h.empty,
          onInvalid: ({ errors }) =>
            h.p([h.Style({ color: '#aa3434' })], [Array.headNonEmpty(errors)]),
        }),
      ],
    )
  const isSubmitting = model.submission._tag === 'Submitting'
  const isSubmitDisabled = !isFormValid(model) || isSubmitting

  return h.div(
    [h.Style({ padding: 24, gap: 20 })],
    [
      h.h1(
        [h.Style({ fontSize: 28, fontWeight: 'bold', color: '#182c25' })],
        ['Join our waitlist'],
      ),
      fieldView('Name', model.name, value => Message.UpdatedName({ value })),
      fieldView('Email', model.email, value => Message.UpdatedEmail({ value })),
      fieldView('Message', model.messageText, value =>
        Message.UpdatedMessageText({ value }),
      ),
      h.button(
        [
          h.Style({
            backgroundColor: isSubmitDisabled ? '#dce5df' : '#182c25',
            color: isSubmitDisabled ? '#627a6c' : '#ffffff',
            borderRadius: 8,
            padding: 14,
            fontSize: 16,
            textAlign: 'center',
          }),
          h.Disabled(isSubmitDisabled),
          h.OnClick(Message.ClickedFormSubmit()),
        ],
        [isSubmitting ? 'Joining…' : 'Join waitlist'],
      ),
      Submission.match(model.submission, {
        NotSubmitted: () => h.empty,
        Submitting: () => h.empty,
        SubmitSuccess: ({ confirmationText }) =>
          h.p([h.Style({ color: '#36624b' })], [confirmationText]),
        SubmitError: ({ error }) =>
          h.p([h.Style({ color: '#aa3434' })], [error]),
      }),
    ],
  )
}
