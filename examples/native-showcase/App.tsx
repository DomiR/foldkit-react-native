import { Option } from 'effect'
import { KeyValueStore } from 'effect/persistence'
import {
  Model,
  init,
  subscriptions,
  update,
} from 'strict-showcase-example/showcase'
import { showcaseStrictView } from 'strict-showcase-example/showcaseStrictView'
import * as Todo from 'todo-example/program'

import {
  FoldkitRoot,
  makeNativeProgram,
  makeNativeAnimationHost,
} from '@foldkit/native'

const animationHost = makeNativeAnimationHost()

const program = makeNativeProgram({
  Model,
  init: () => init(Todo.Flags.make({ todos: Option.none() })),
  update,
  subscriptions,
  animationHost,
  resources: KeyValueStore.layerMemory,
  view: showcaseStrictView,
})

export default function App() {
  return <FoldkitRoot program={program} />
}
