import { Option } from 'effect'
import { KeyValueStore } from 'effect/persistence'
import {
  Message,
  Model,
  init,
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
  init: () => init(Todo.Flags.make({ todos: Option.none() })),
  update,
  subscriptions,
  animationHost,
  resources: KeyValueStore.layerMemory,
  view: showcaseStrictView,
  devTools:
    process.env.EXPO_PUBLIC_FOLDKIT_DEVTOOLS === '1'
      ? {
          Message,
          name: 'Native Showcase',
          ...(process.env.EXPO_PUBLIC_FOLDKIT_DEVTOOLS_HOST !== undefined && {
            relayHost: process.env.EXPO_PUBLIC_FOLDKIT_DEVTOOLS_HOST,
          }),
          ...(process.env.EXPO_PUBLIC_FOLDKIT_DEVTOOLS_PORT !== undefined && {
            relayPort: Number(process.env.EXPO_PUBLIC_FOLDKIT_DEVTOOLS_PORT),
          }),
        }
      : false,
})

export default function App() {
  return <FoldkitRoot program={program} />
}
