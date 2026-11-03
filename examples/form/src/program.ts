import { Array, Duration, Effect, Random, Schema } from 'effect'
import * as Command from 'foldkit/command'
import {
  Field,
  Invalid,
  NotValidated,
  Rule,
  Valid,
  Validating,
  allValid,
  makeRules,
  validate,
} from 'foldkit/fieldValidation'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import type * as Update from 'foldkit/update'

const nameRules = makeRules({
  rules: [Rule.minLength(2, 'Name must be at least 2 characters')],
})

const emailRules = makeRules({
  required: 'Email is required',
  rules: [Rule.email('Please enter a valid email address')],
})

// MODEL

export const Submission = defineTaggedUnion({
  NotSubmitted: {},
  Submitting: {},
  SubmitSuccess: { confirmationText: Schema.String },
  SubmitError: { error: Schema.String },
})

export type Submission = typeof Submission.Type

export const Model = Schema.Struct({
  name: Field(Schema.String),
  email: Field(Schema.String),
  messageText: Field(Schema.String),
  submission: Submission,
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  UpdatedName: { value: Schema.String },
  UpdatedEmail: { value: Schema.String },
  CompletedValidateEmail: { field: Field(Schema.String) },
  UpdatedMessageText: { value: Schema.String },
  ClickedFormSubmit: {},
  SucceededSubmitForm: { name: Schema.String },
  FailedSubmitForm: {},
})

export type Message = typeof Message.Type

// INIT

export const initialModel: Model = {
  name: NotValidated({ value: '' }),
  email: NotValidated({ value: '' }),
  messageText: NotValidated({ value: '' }),
  submission: Submission.NotSubmitted(),
}

export const init = (): Update.Return<Model, Message> => ({
  model: initialModel,
})

// FIELD VALIDATION

const EMAILS_ON_WAITLIST = [
  'test@example.com',
  'demo@email.com',
  'admin@test.com',
]

const isEmailOnWaitlist = (email: string): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    yield* Effect.sleep(Duration.millis(FAKE_API_DELAY_MS))
    return Array.contains(EMAILS_ON_WAITLIST, email.toLowerCase())
  })

export const ValidateEmail = Command.define('ValidateEmail', {
  args: { email: Schema.String },
  messages: [Message.CompletedValidateEmail],
  execute: ({ email }) =>
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
    }),
})

const validateName = validate(nameRules)
const validateEmail = validate(emailRules)

export const isFormValid = (model: Model): boolean =>
  allValid([
    [model.name, nameRules],
    [model.email, emailRules],
  ])

// UPDATE

export const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message>>(message, {
    UpdatedName: ({ value }) => ({
      model: modifyFields(model, {
        name: () => validateName(value),
      }),
    }),

    UpdatedEmail: ({ value }) => {
      const validateEmailResult = validateEmail(value)

      if (validateEmailResult._tag === 'Valid') {
        return {
          model: modifyFields(model, {
            email: () => Validating({ value }),
          }),
          commands: [ValidateEmail({ email: value })],
        }
      } else {
        return {
          model: modifyFields(model, {
            email: () => validateEmailResult,
          }),
        }
      }
    },

    CompletedValidateEmail: ({ field }) => {
      if (field.value === model.email.value) {
        return {
          model: modifyFields(model, {
            email: () => field,
          }),
        }
      } else {
        return { model }
      }
    },

    UpdatedMessageText: ({ value }) => ({
      model: modifyFields(model, {
        messageText: () => Valid({ value }),
      }),
    }),

    ClickedFormSubmit: () => {
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

    SucceededSubmitForm: ({ name }) => ({
      model: modifyFields(model, {
        submission: () =>
          Submission.SubmitSuccess({
            confirmationText: `Welcome to the waitlist, ${name}! We'll be in touch soon.`,
          }),
      }),
    }),

    FailedSubmitForm: () => ({
      model: modifyFields(model, {
        submission: () =>
          Submission.SubmitError({
            error:
              'Sorry, there was an error adding you to the waitlist. Please try again.',
          }),
      }),
    }),
  })

// COMMAND

const FAKE_API_DELAY_MS = 500

export const SubmitForm = Command.define('SubmitForm', {
  args: {
    name: Schema.String,
    email: Schema.String,
    messageText: Schema.String,
  },
  messages: [Message.SucceededSubmitForm, Message.FailedSubmitForm],
  execute: ({ name }) =>
    Effect.gen(function* () {
      yield* Effect.sleep(`${FAKE_API_DELAY_MS} millis`)

      const isSuccess = yield* Random.nextBoolean
      if (isSuccess) {
        return Message.SucceededSubmitForm({ name })
      } else {
        return Message.FailedSubmitForm()
      }
    }),
})
