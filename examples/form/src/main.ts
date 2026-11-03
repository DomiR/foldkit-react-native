import clsx from 'clsx'
import { Array } from 'effect'
import * as FieldValidation from 'foldkit/fieldValidation'
import type { Field } from 'foldkit/fieldValidation'
import { type Attribute, Document, Html, HtmlBuilder } from 'foldkit/html'

import { Button, Input, Textarea } from '@foldkit/ui'

import { Message, type Model, Submission, isFormValid } from './program'

export {
  Message,
  Model,
  SubmitForm,
  ValidateEmail,
  initialModel,
  init,
  update,
} from './program'

// VIEW

const LABEL_CLASS = 'text-sm font-medium text-gray-700'
const DESCRIPTION_CLASS = 'text-sm mt-1'

const borderClass = (field: Field<string>): string =>
  FieldValidation.match(field, {
    onNotValidated: () => 'border-gray-300',
    onValidating: () => 'border-blue-300',
    onValid: () => 'border-green-500',
    onInvalid: () => 'border-red-500',
  })

const inputClassName = (field: Field<string>): string =>
  clsx(
    'w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500',
    borderClass(field),
  )

const statusIndicator = (field: Field<string>, h: HtmlBuilder<Message>): Html =>
  FieldValidation.match(field, {
    onNotValidated: () => h.empty,
    onValidating: () =>
      h.span([h.Class('text-blue-600 text-sm animate-spin')], ['◐']),
    onValid: () => h.span([h.Class('text-green-600 text-sm')], ['✓']),
    onInvalid: () => h.empty,
  })

const descriptionView = (
  field: Field<string>,
  descriptionAttributes: ReadonlyArray<Attribute<Message>>,
  h: HtmlBuilder<Message>,
): Html =>
  FieldValidation.match(field, {
    onNotValidated: () => h.empty,
    onValidating: () =>
      h.span(
        [
          ...descriptionAttributes,
          h.Class(clsx(DESCRIPTION_CLASS, 'text-blue-600')),
        ],
        ['Checking...'],
      ),
    onValid: () => h.empty,
    onInvalid: ({ errors }) =>
      h.span(
        [
          ...descriptionAttributes,
          h.Class(clsx(DESCRIPTION_CLASS, 'text-red-600')),
        ],
        [Array.headNonEmpty(errors)],
      ),
  })

const inputFieldView = (
  id: string,
  labelText: string,
  field: Field<string>,
  onUpdate: (value: string) => Message,
  type: string,
  h: HtmlBuilder<Message>,
): Html =>
  Input.view(
    {
      id,
      value: field.value,
      onInput: onUpdate,
      isInvalid: field._tag === 'Invalid',
      hasDescription: field._tag === 'Validating' || field._tag === 'Invalid',
      type,
      toView: attributes =>
        h.div(
          [h.Class('mb-4')],
          [
            h.div(
              [h.Class('flex items-center gap-2 mb-2')],
              [
                h.label(
                  [...attributes.label, h.Class(LABEL_CLASS)],
                  [labelText],
                ),
                statusIndicator(field, h),
              ],
            ),
            h.input([...attributes.input, h.Class(inputClassName(field))]),
            descriptionView(field, attributes.description, h),
          ],
        ),
    },
    h,
  )

const textareaFieldView = (
  id: string,
  labelText: string,
  field: Field<string>,
  onUpdate: (value: string) => Message,
  h: HtmlBuilder<Message>,
): Html =>
  Textarea.view(
    {
      id,
      value: field.value,
      onInput: onUpdate,
      isInvalid: field._tag === 'Invalid',
      hasDescription: field._tag === 'Validating' || field._tag === 'Invalid',
      toView: attributes =>
        h.div(
          [h.Class('mb-4')],
          [
            h.div(
              [h.Class('flex items-center gap-2 mb-2')],
              [
                h.label(
                  [...attributes.label, h.Class(LABEL_CLASS)],
                  [labelText],
                ),
                statusIndicator(field, h),
              ],
            ),
            h.textarea([
              ...attributes.textarea,
              h.Class(inputClassName(field)),
            ]),
            descriptionView(field, attributes.description, h),
          ],
        ),
    },
    h,
  )

export const view = (model: Model, h: HtmlBuilder<Message>): Document => {
  const canSubmit = isFormValid(model) && model.submission._tag !== 'Submitting'

  const body = h.div(
    [h.Class('min-h-screen bg-gray-100 py-8')],
    [
      h.div(
        [h.Class('max-w-md mx-auto bg-white rounded-xl shadow-lg p-6')],
        [
          h.h1(
            [h.Class('text-3xl font-bold text-gray-800 text-center mb-8')],
            ['Join Our Waitlist'],
          ),

          h.form(
            [h.Class('space-y-4'), h.OnSubmit(Message.ClickedFormSubmit())],
            [
              inputFieldView(
                'name',
                'Name',
                model.name,
                value => Message.UpdatedName({ value }),
                'text',
                h,
              ),
              inputFieldView(
                'email',
                'Email',
                model.email,
                value => Message.UpdatedEmail({ value }),
                'email',
                h,
              ),
              textareaFieldView(
                'message',
                "Anything you'd like to share with us?",
                model.messageText,
                value => Message.UpdatedMessageText({ value }),
                h,
              ),

              Button.view(
                {
                  type: 'submit',
                  isDisabled: !canSubmit,
                  toView: attributes =>
                    h.button(
                      [
                        ...attributes.button,
                        h.Class(
                          clsx(
                            'w-full py-2 px-4 rounded-md transition',
                            canSubmit
                              ? 'bg-blue-500 text-white hover:bg-blue-600'
                              : 'bg-gray-300 text-gray-500 cursor-not-allowed',
                          ),
                        ),
                      ],
                      [
                        model.submission._tag === 'Submitting'
                          ? 'Joining...'
                          : 'Join Waitlist',
                      ],
                    ),
                },
                h,
              ),
            ],
          ),

          Submission.match(model.submission, {
            NotSubmitted: () => h.empty,
            Submitting: () => h.empty,
            SubmitSuccess: ({ confirmationText }) =>
              h.div(
                [
                  h.Role('status'),
                  h.Class(
                    'mt-4 p-3 bg-green-100 border border-green-400 text-green-700 rounded-lg',
                  ),
                ],
                [confirmationText],
              ),
            SubmitError: ({ error }) =>
              h.div(
                [
                  h.Role('alert'),
                  h.Class(
                    'mt-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded-lg',
                  ),
                ],
                [error],
              ),
          }),
        ],
      ),
    ],
  )

  return { title: 'Foldkit Form Example', body }
}
