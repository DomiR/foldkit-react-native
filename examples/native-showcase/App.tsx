import { Layer, Option } from 'effect'
import { KeyValueStore } from 'effect/persistence'
import { nativeShowcaseNavigation } from 'strict-showcase-example/navigation'
import {
  Model,
  init,
  routing,
  subscriptions,
  update,
} from 'strict-showcase-example/showcase'
import { showcaseStrictView } from 'strict-showcase-example/showcaseStrictView'
import * as Todo from 'todo-example/program'

import {
  FoldkitRoot,
  makeNativeAnimationHost,
  makeNativeProgram,
} from '@foldkit/native'

const animationHost = makeNativeAnimationHost()

const program = makeNativeProgram({
  Model,
  init: url => init(Todo.Flags.make({ todos: Option.none() }), url),
  update,
  subscriptions,
  animationHost,
  routing,
  resources: Layer.merge(KeyValueStore.layerMemory, nativeShowcaseNavigation),
  view: showcaseStrictView,
})

export default function App() {
  return <FoldkitRoot program={program} />
}
