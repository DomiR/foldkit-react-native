import { Array, Match, Option, String } from 'effect'
import type { StrictStyle, StrictView } from 'foldkit/strict'

import { Message } from './message'
import { EditingState, type Filter, type Model } from './model'

const buttonStyle: StrictStyle = {
  backgroundColor: '#182c25',
  color: '#ffffff',
  paddingHorizontal: 14,
  paddingVertical: 10,
  borderRadius: 8,
  textAlign: 'center',
}
const inputStyle: StrictStyle = {
  flex: 1,
  minWidth: 0,
  backgroundColor: '#ffffff',
  color: '#182c25',
  borderWidth: 1,
  borderColor: '#acbab2',
  borderRadius: 8,
  paddingHorizontal: 12,
  paddingVertical: 10,
  fontSize: 16,
}
const filters: ReadonlyArray<Filter> = ['All', 'Active', 'Completed']

export const strictView: StrictView<Model, Message> = (model, h) => {
  const visibleTodos = Array.filter(model.todos, todo =>
    Match.value(model.filter).pipe(
      Match.when('All', () => true),
      Match.when('Active', () => !todo.completed),
      Match.when('Completed', () => todo.completed),
      Match.exhaustive,
    ),
  )
  const activeCount = Array.length(
    Array.filter(model.todos, todo => !todo.completed),
  )

  return h.div(
    [h.Style({ padding: 24, gap: 20 })],
    [
      h.h1(
        [h.Style({ fontSize: 28, fontWeight: 'bold', color: '#182c25' })],
        ['Todo'],
      ),
      h.div(
        [h.Style({ flexDirection: 'row', gap: 10 })],
        [
          h.input([
            h.Style(inputStyle),
            h.AriaLabel('New todo'),
            h.Placeholder('What needs to be done?'),
            h.Value(model.newTodoText),
            h.OnInput(text => Message.UpdatedNewTodo({ text })),
            h.OnSubmitEditing(Message.AddedTodo()),
          ]),
          h.button(
            [
              h.Style(buttonStyle),
              h.Disabled(String.isEmpty(String.trim(model.newTodoText))),
              h.OnClick(Message.AddedTodo()),
            ],
            ['Add'],
          ),
        ],
      ),
      h.ul(
        [h.Style({ gap: 10 })],
        Array.map(visibleTodos, todo => {
          const maybeEditingText = EditingState.match(model.editing, {
            NotEditing: () => Option.none<string>(),
            Editing: ({ id, text }) =>
              Option.liftPredicate(text, () => id === todo.id),
          })
          const editButton = Option.match(maybeEditingText, {
            onNone: () => ({
              label: 'Edit',
              ariaLabel: `Edit ${todo.text}`,
              message: Message.StartedEditing({ id: todo.id }),
            }),
            onSome: () => ({
              label: 'Save',
              ariaLabel: `Save ${todo.text}`,
              message: Message.SavedEdit(),
            }),
          })

          return h.keyed('li')(
            todo.id,
            [
              h.Style({
                flexDirection: 'row',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 10,
              }),
            ],
            [
              h.input([
                h.Checked(todo.completed),
                h.AriaLabel(`Complete ${todo.text}`),
                h.OnClick(Message.ToggledTodo({ id: todo.id })),
                h.Style({
                  width: 28,
                  height: 28,
                  borderWidth: 1,
                  borderColor: '#627a6c',
                  borderRadius: 6,
                  backgroundColor: todo.completed ? '#627a6c' : '#ffffff',
                }),
              ]),
              Option.match(maybeEditingText, {
                onNone: () =>
                  h.p(
                    [
                      h.Style({
                        flex: 1,
                        fontSize: 16,
                        color: '#182c25',
                        textDecorationLine: todo.completed
                          ? 'line-through'
                          : 'none',
                      }),
                    ],
                    [todo.text],
                  ),
                onSome: text =>
                  h.input([
                    h.Style(inputStyle),
                    h.AriaLabel('Edit todo'),
                    h.Value(text),
                    h.OnInput(text => Message.UpdatedEditingTodo({ text })),
                    h.OnSubmitEditing(Message.SavedEdit()),
                  ]),
              }),
              h.button(
                [
                  h.Style(buttonStyle),
                  h.AriaLabel(editButton.ariaLabel),
                  h.OnClick(editButton.message),
                ],
                [editButton.label],
              ),
              Option.isSome(maybeEditingText)
                ? h.button(
                    [h.Style(buttonStyle), h.OnClick(Message.CancelledEdit())],
                    ['Cancel'],
                  )
                : h.empty,
              h.button(
                [
                  h.Style(buttonStyle),
                  h.AriaLabel(`Delete ${todo.text}`),
                  h.OnClick(Message.DeletedTodo({ id: todo.id })),
                ],
                ['Delete'],
              ),
            ],
          )
        }),
      ),
      Array.isArrayEmpty(visibleTodos)
        ? h.p(
            [h.Style({ color: '#627a6c', paddingVertical: 12 })],
            ['No todos in this view'],
          )
        : h.empty,
      h.p(
        [h.Style({ color: '#627a6c' })],
        [
          `${activeCount} active, ${model.todos.length - activeCount} completed`,
        ],
      ),
      h.div(
        [h.Style({ flexDirection: 'row', flexWrap: 'wrap', gap: 8 })],
        Array.map(filters, filter =>
          h.keyed('button')(
            filter,
            [
              h.Style({
                ...buttonStyle,
                backgroundColor:
                  model.filter === filter ? '#182c25' : '#dce5df',
                color: model.filter === filter ? '#ffffff' : '#182c25',
              }),
              h.OnClick(Message.SelectedFilter({ filter })),
            ],
            [filter],
          ),
        ),
      ),
      h.div(
        [h.Style({ flexDirection: 'row', flexWrap: 'wrap', gap: 8 })],
        [
          h.button(
            [
              h.Style(buttonStyle),
              h.Disabled(
                Array.match(model.todos, {
                  onEmpty: () => true,
                  onNonEmpty: () => false,
                }),
              ),
              h.OnClick(Message.ToggledAll()),
            ],
            ['Toggle all'],
          ),
          h.button(
            [
              h.Style(buttonStyle),
              h.Disabled(model.todos.length === activeCount),
              h.OnClick(Message.ClearedCompleted()),
            ],
            ['Clear completed'],
          ),
        ],
      ),
    ],
  )
}
