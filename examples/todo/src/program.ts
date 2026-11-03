import { Array, Clock, Effect, Option, Random, Schema, String } from 'effect'
import { KeyValueStore } from 'effect/persistence'
import * as Command from 'foldkit/command'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import type * as Update from 'foldkit/update'

// CONSTANT

const TODOS_STORAGE_KEY = 'todos'

// MODEL

export const Todo = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
  completed: Schema.Boolean,
  createdAt: Schema.Number,
})
export type Todo = typeof Todo.Type

export const Todos = Schema.Array(Todo)
export type Todos = typeof Todos.Type

const TodosJsonString = Schema.fromJsonString(Schema.toCodecJson(Todos))

export const Filter = Schema.Literals(['All', 'Active', 'Completed'])
export type Filter = typeof Filter.Type

export const EditingState = defineTaggedUnion({
  NotEditing: {},
  Editing: { id: Schema.String, text: Schema.String },
})
export type EditingState = typeof EditingState.Type

export const Model = Schema.Struct({
  todos: Todos,
  newTodoText: Schema.String,
  filter: Filter,
  editing: EditingState,
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  UpdatedNewTodo: { text: Schema.String },
  UpdatedEditingTodo: { text: Schema.String },
  AddedTodo: {},
  CompletedGenerateTodo: {
    id: Schema.String,
    timestamp: Schema.Number,
    text: Schema.String,
  },
  DeletedTodo: { id: Schema.String },
  ToggledTodo: { id: Schema.String },
  StartedEditing: { id: Schema.String },
  SavedEdit: {},
  CancelledEdit: {},
  ToggledAll: {},
  ClearedCompleted: {},
  SelectedFilter: { filter: Filter },
  SucceededSaveTodos: { todos: Todos },
  FailedSaveTodos: {},
})
export type Message = typeof Message.Type

// FLAGS

export const Flags = Schema.Struct({
  todos: Schema.Option(Todos),
})
export type Flags = typeof Flags.Type

// INIT

export const init = (flags: Flags): Update.Return<Model, Message> => ({
  model: {
    todos: Option.getOrElse(flags.todos, () => []),
    newTodoText: '',
    filter: 'All',
    editing: EditingState.NotEditing(),
  },
})

// UPDATE

type UpdateReturn = Update.Return<Model, Message, KeyValueStore.KeyValueStore>

export const update = (model: Model, message: Message) =>
  Message.match<UpdateReturn>(message, {
    UpdatedNewTodo: ({ text }) => ({
      model: modifyFields(model, {
        newTodoText: () => text,
      }),
    }),

    UpdatedEditingTodo: ({ text }) => ({
      model: modifyFields(model, {
        editing: () =>
          EditingState.match(model.editing, {
            NotEditing: () => model.editing,
            Editing: ({ id }) => EditingState.Editing({ id, text }),
          }),
      }),
    }),

    AddedTodo: () => {
      if (String.isEmpty(String.trim(model.newTodoText))) {
        return { model }
      }

      return {
        model,
        commands: [GenerateTodo({ text: String.trim(model.newTodoText) })],
      }
    },

    CompletedGenerateTodo: ({ id, timestamp, text }) => {
      const newTodo: Todo = {
        id,
        text,
        completed: false,
        createdAt: timestamp,
      }

      const nextTodos = [...model.todos, newTodo]

      return {
        model: modifyFields(model, {
          todos: () => nextTodos,
          newTodoText: () => '',
        }),
        commands: [SaveTodos({ todos: nextTodos })],
      }
    },

    DeletedTodo: ({ id }) => {
      const nextTodos = Array.filter(model.todos, todo => todo.id !== id)

      return {
        model: modifyFields(model, {
          todos: () => nextTodos,
        }),
        commands: [SaveTodos({ todos: nextTodos })],
      }
    },

    ToggledTodo: ({ id }) => {
      const nextTodos = Array.map(model.todos, todo =>
        todo.id === id
          ? modifyFields(todo, { completed: completed => !completed })
          : todo,
      )

      return {
        model: modifyFields(model, {
          todos: () => nextTodos,
        }),
        commands: [SaveTodos({ todos: nextTodos })],
      }
    },

    StartedEditing: ({ id }) => {
      const maybeTodo = Array.findFirst(model.todos, todo => todo.id === id)
      return {
        model: modifyFields(model, {
          editing: () =>
            EditingState.Editing({
              id,
              text: Option.match(maybeTodo, {
                onNone: () => '',
                onSome: todo => todo.text,
              }),
            }),
        }),
      }
    },

    SavedEdit: () =>
      EditingState.match<UpdateReturn>(model.editing, {
        NotEditing: () => ({ model }),

        Editing: ({ id, text }) => {
          if (String.isEmpty(String.trim(text))) {
            return {
              model: modifyFields(model, {
                editing: () => EditingState.NotEditing(),
              }),
            }
          }

          const nextTodos = Array.map(model.todos, todo =>
            todo.id === id
              ? modifyFields(todo, { text: () => String.trim(text) })
              : todo,
          )

          return {
            model: modifyFields(model, {
              todos: () => nextTodos,
              editing: () => EditingState.NotEditing(),
            }),
            commands: [SaveTodos({ todos: nextTodos })],
          }
        },
      }),

    CancelledEdit: () => ({
      model: modifyFields(model, {
        editing: () => EditingState.NotEditing(),
      }),
    }),

    ToggledAll: () => {
      const allCompleted = Array.every(model.todos, todo => todo.completed)
      const nextTodos = Array.map(model.todos, todo =>
        modifyFields(todo, {
          completed: () => !allCompleted,
        }),
      )

      return {
        model: modifyFields(model, {
          todos: () => nextTodos,
        }),
        commands: [SaveTodos({ todos: nextTodos })],
      }
    },

    ClearedCompleted: () => {
      const nextTodos = Array.filter(model.todos, todo => !todo.completed)

      return {
        model: modifyFields(model, {
          todos: () => nextTodos,
        }),
        commands: [SaveTodos({ todos: nextTodos })],
      }
    },

    SelectedFilter: ({ filter }) => ({
      model: modifyFields(model, {
        filter: () => filter,
      }),
    }),

    SucceededSaveTodos: ({ todos }) => ({
      model: modifyFields(model, {
        todos: () => todos,
      }),
    }),

    FailedSaveTodos: () => ({ model }),
  })

// COMMAND

export const GenerateTodo = Command.define('GenerateTodo', {
  args: { text: Schema.String },
  messages: [Message.CompletedGenerateTodo],
  execute: ({ text }) =>
    Effect.gen(function* () {
      const id = yield* Random.nextIntBetween(0, Number.MAX_SAFE_INTEGER).pipe(
        Effect.map(value => value.toString(36)),
      )
      const timestamp = yield* Clock.currentTimeMillis
      return Message.CompletedGenerateTodo({ id, timestamp, text })
    }),
})

export const SaveTodos = Command.define('SaveTodos', {
  args: { todos: Todos },
  messages: [Message.SucceededSaveTodos, Message.FailedSaveTodos],
  execute: ({ todos }) =>
    Effect.gen(function* () {
      const store = yield* KeyValueStore.KeyValueStore
      const encodedTodos = yield* Schema.encodeEffect(TodosJsonString)(todos)
      yield* store.set(TODOS_STORAGE_KEY, encodedTodos)
      return Message.SucceededSaveTodos({ todos })
    }).pipe(Effect.catch(() => Effect.succeed(Message.FailedSaveTodos()))),
})

// FLAG

export const flags: Effect.Effect<Flags, never, KeyValueStore.KeyValueStore> =
  Effect.gen(function* () {
    const store = yield* KeyValueStore.KeyValueStore
    const todosJson = yield* Effect.fromOption(
      Option.fromNullishOr(yield* store.get(TODOS_STORAGE_KEY)),
    )

    const decodeTodos = Schema.decodeEffect(TodosJsonString)
    const todos = yield* decodeTodos(todosJson)

    return { todos: Option.some(todos) }
  }).pipe(Effect.catch(() => Effect.succeed({ todos: Option.none() })))
