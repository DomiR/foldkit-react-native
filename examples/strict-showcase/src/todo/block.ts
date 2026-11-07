import { Array, Clock, Effect, Option, Random, Schema, String } from 'effect'
import { KeyValueStore } from 'effect/persistence'
import { Block } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'

export const TODOS_STORAGE_KEY = 'todos'

export const Todo = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
  completed: Schema.Boolean,
  createdAt: Schema.Number,
})
export type Todo = typeof Todo.Type

export const Todos = Schema.Array(Todo)
export type Todos = typeof Todos.Type

export const TodosJsonString = Schema.fromJsonString(Schema.toCodecJson(Todos))
export type TodosJsonString = typeof TodosJsonString.Type

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

export const TodoKey = Symbol('Todo')
export const TodoBlock = Block.make('Todo', {
  key: TodoKey,
  InitArgs: Schema.Tuple([]),
  view: { kind: 'Element' },
  effects: { services: [KeyValueStore.KeyValueStore] },
  Model,
  Message,
})

const { makeCommand, makeComposition, makeFieldsStep, makeNoopStep } = TodoBlock

export const TodoComposition = makeComposition()

export const GenerateTodo = makeCommand('GenerateTodo', {
  args: { text: Schema.String },
  messages: [Message.CompletedGenerateTodo],
  handler: function* () {
    const clock = yield* Clock.Clock

    return ({ text }) =>
      Effect.gen(function* () {
        const id = yield* Random.nextIntBetween(
          0,
          Number.MAX_SAFE_INTEGER,
        ).pipe(Effect.map(value => value.toString(36)))
        const timestamp = yield* clock.currentTimeMillis

        return Message.CompletedGenerateTodo({ id, timestamp, text })
      })
  },
})

export const SaveTodos = makeCommand('SaveTodos', {
  args: { todos: Todos },
  messages: [Message.SucceededSaveTodos, Message.FailedSaveTodos],
  handler: function* () {
    const store = yield* KeyValueStore.KeyValueStore

    return ({ todos }) =>
      Effect.gen(function* () {
        const encodedTodos = yield* Schema.encodeEffect(TodosJsonString)(todos)
        yield* store.set(TODOS_STORAGE_KEY, encodedTodos)
        return Message.SucceededSaveTodos({ todos })
      }).pipe(Effect.catch(() => Effect.succeed(Message.FailedSaveTodos())))
  },
})

export const init = TodoComposition.makeInit(() => ({
  model: Model.make({
    todos: [],
    newTodoText: '',
    filter: 'All',
    editing: EditingState.NotEditing(),
  }),
}))

const { makeUpdate } = TodoComposition

const editTodos = makeUpdate({
  UpdatedNewTodo: makeFieldsStep.fromMessage(({ text }) => ({
    newTodoText: () => text,
  })),

  UpdatedEditingTodo: makeFieldsStep((model, { text }) => ({
    editing: () =>
      EditingState.match(model.editing, {
        NotEditing: () => model.editing,
        Editing: ({ id }) => EditingState.Editing({ id, text }),
      }),
  })),

  AddedTodo: model => {
    if (String.isEmpty(String.trim(model.newTodoText))) {
      return { model }
    }

    return {
      model,
      commands: [GenerateTodo({ text: String.trim(model.newTodoText) })],
    }
  },

  CompletedGenerateTodo: (model, { id, timestamp, text }) => {
    const newTodo: Todo = {
      id,
      text,
      completed: false,
      createdAt: timestamp,
    }

    const updatedTodos = [...model.todos, newTodo]

    return {
      model: modifyFields(model, {
        todos: () => updatedTodos,
        newTodoText: () => '',
      }),
    }
  },

  DeletedTodo: (model, { id }) => {
    const updatedTodos = Array.filter(model.todos, todo => todo.id !== id)

    return {
      model: modifyFields(model, {
        todos: () => updatedTodos,
      }),
    }
  },

  ToggledTodo: (model, { id }) => {
    const updatedTodos = Array.map(model.todos, todo =>
      todo.id === id
        ? modifyFields(todo, { completed: completed => !completed })
        : todo,
    )

    return {
      model: modifyFields(model, {
        todos: () => updatedTodos,
      }),
    }
  },

  StartedEditing: makeFieldsStep((model, { id }) => {
    const maybeTodo = Array.findFirst(model.todos, todo => todo.id === id)
    return {
      editing: () =>
        EditingState.Editing({
          id,
          text: Option.match(maybeTodo, {
            onNone: () => '',
            onSome: todo => todo.text,
          }),
        }),
    }
  }),

  SavedEdit: model =>
    EditingState.match(model.editing, {
      NotEditing: () => ({ model }),

      Editing: ({ id, text }) => {
        if (String.isEmpty(String.trim(text))) {
          return {
            model: modifyFields(model, {
              editing: () => EditingState.NotEditing(),
            }),
          }
        }

        const updatedTodos = Array.map(model.todos, todo =>
          todo.id === id
            ? modifyFields(todo, { text: () => String.trim(text) })
            : todo,
        )

        return {
          model: modifyFields(model, {
            todos: () => updatedTodos,
            editing: () => EditingState.NotEditing(),
          }),
        }
      },
    }),

  CancelledEdit: makeFieldsStep(() => ({
    editing: () => EditingState.NotEditing(),
  })),

  ToggledAll: model => {
    const allCompleted = Array.every(model.todos, todo => todo.completed)
    const updatedTodos = Array.map(model.todos, todo =>
      modifyFields(todo, {
        completed: () => !allCompleted,
      }),
    )

    return {
      model: modifyFields(model, {
        todos: () => updatedTodos,
      }),
    }
  },

  ClearedCompleted: model => {
    const updatedTodos = Array.filter(model.todos, todo => !todo.completed)

    return {
      model: modifyFields(model, {
        todos: () => updatedTodos,
      }),
    }
  },

  SelectedFilter: makeFieldsStep.fromMessage(({ filter }) => ({
    filter: () => filter,
  })),

  SucceededSaveTodos: makeFieldsStep.fromMessage(({ todos }) => ({
    todos: () => todos,
  })),

  FailedSaveTodos: makeNoopStep(),
})

const persistTodos = makeUpdate.except(['SucceededSaveTodos'])(
  (model, _message, { before }) => ({
    model,
    commands: Array.filter(
      [SaveTodos({ todos: model.todos })],
      () => model.todos !== before.todos,
    ),
  }),
)

export const update = makeUpdate.compose(editTodos, persistTodos)
