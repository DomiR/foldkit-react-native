import { Array, Duration, Effect, Layer, Random, Schema } from 'effect'
import { Block } from 'foldkit'
import {
  Invalid,
  NotValidated,
  Valid,
  Validating,
} from 'foldkit/fieldValidation'
import { modifyFields } from 'foldkit/struct'

import { Message } from './message'
import { Model, Submission } from './model'
import { isFormValid, validateEmail, validateName } from './validation'

export { Message } from './message'
export { Model } from './model'

const FAKE_API_DELAY_MS = 500

const EMAILS_ON_WAITLIST = [
  'test@example.com',
  'demo@email.com',
  'admin@test.com',
]

// BLOCK

export const FormKey = Symbol('Form')
export const FormBlock = Block.make('Form', {
  key: FormKey,
  InitArgs: Schema.Tuple([]),
  view: { kind: 'Element' },
  Model,
  Message,
})

const { makeCommand, makeComposition, makeFieldsStep } = FormBlock

export const FormComposition = makeComposition()

// COMMAND

const isEmailOnWaitlist = (email: string): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    yield* Effect.sleep(Duration.millis(FAKE_API_DELAY_MS))
    return Array.contains(EMAILS_ON_WAITLIST, email.toLowerCase())
  })

export const ValidateEmail = makeCommand('ValidateEmail', {
  args: { email: Schema.String },
  messages: [Message.CompletedValidateEmail],
  handler: function* () {
    return ({ email }) =>
      Effect.gen(function* () {
        if (yield* isEmailOnWaitlist(email)) {
          return Message.CompletedValidateEmail({
            field: Invalid({
              value: email,
              errors: ['This email is already on our waitlist'],
            }),
          })
        } else {
          return Message.CompletedValidateEmail({
            field: Valid({ value: email }),
          })
        }
      })
  },
})

export const SubmitForm = makeCommand('SubmitForm', {
  args: {
    name: Schema.String,
    email: Schema.String,
    messageText: Schema.String,
  },
  messages: [Message.SucceededSubmitForm, Message.FailedSubmitForm],
  handler: function* () {
    return ({ name }) =>
      Effect.gen(function* () {
        yield* Effect.sleep(Duration.millis(FAKE_API_DELAY_MS))

        const isSuccess = yield* Random.nextBoolean
        if (isSuccess) {
          return Message.SucceededSubmitForm({ name })
        } else {
          return Message.FailedSubmitForm()
        }
      })
  },
})

export const EffectsLayer = Layer.mergeAll(
  ValidateEmail.layer,
  SubmitForm.layer,
)

// INIT

export const initialModel: Model = {
  name: NotValidated({ value: '' }),
  email: NotValidated({ value: '' }),
  messageText: NotValidated({ value: '' }),
  submission: Submission.NotSubmitted(),
}

export const init = FormComposition.makeInit(() => ({
  model: initialModel,
}))

// UPDATE

export const update = FormComposition.makeUpdate({
  UpdatedName: makeFieldsStep.fromMessage(({ value }) => ({
    name: () => validateName(value),
  })),
  UpdatedEmail: (model, { value }) => {
    const validateEmailResult = validateEmail(value)
    if (validateEmailResult._tag === 'Valid') {
      return {
        model: modifyFields(model, { email: () => Validating({ value }) }),
        commands: [ValidateEmail({ email: value })],
      }
    } else {
      return {
        model: modifyFields(model, { email: () => validateEmailResult }),
      }
    }
  },
  CompletedValidateEmail: (model, { field }) => {
    if (field.value === model.email.value) {
      return { model: modifyFields(model, { email: () => field }) }
    } else {
      return { model }
    }
  },
  UpdatedMessageText: makeFieldsStep.fromMessage(({ value }) => ({
    messageText: () => Valid({ value }),
  })),
  ClickedFormSubmit: model => {
    if (model.submission._tag === 'Submitting') {
      return { model }
    }

    if (!isFormValid(model)) {
      return { model }
    }

    return {
      model: modifyFields(model, {
        submission: () => Submission.Submitting(),
      }),
      commands: [
        SubmitForm({
          name: model.name.value,
          email: model.email.value,
          messageText: model.messageText.value,
        }),
      ],
    }
  },
  SucceededSubmitForm: makeFieldsStep.fromMessage(({ name }) => ({
    submission: () =>
      Submission.SubmitSuccess({
        confirmationText: `Welcome to the waitlist, ${name}! We'll be in touch soon.`,
      }),
  })),
  FailedSubmitForm: makeFieldsStep(() => ({
    submission: () =>
      Submission.SubmitError({
        error:
          'Sorry, there was an error adding you to the waitlist. Please try again.',
      }),
  })),
})
