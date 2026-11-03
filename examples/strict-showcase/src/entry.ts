import { Layer } from 'effect'
import * as Runtime from 'foldkit/runtime'
import * as Todo from 'todo-example/program'

import { BrowserKeyValueStore } from '@effect/platform-browser'

import {
  Message,
  Model,
  init,
  subscriptions,
  update,
  view,
  animationHost,
} from './main'

const application = Runtime.makeApplication({
  Model,
  Flags: Todo.Flags,
  init,
  update,
  view,
  subscriptions,
  resources: Layer.merge(
    BrowserKeyValueStore.layerLocalStorage,
    animationHost.layer,
  ),
  container: document.getElementById('root'),
  devTools: { Message },
})

Runtime.run(application, { flags: Todo.flags })
