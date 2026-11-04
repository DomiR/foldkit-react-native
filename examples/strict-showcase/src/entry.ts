import { Layer } from 'effect'
import * as Runtime from 'foldkit/runtime'
import * as Todo from 'todo-example/program'

import { BrowserKeyValueStore } from '@effect/platform-browser'

import {
  Message,
  Model,
  animationHost,
  init,
  routing,
  subscriptions,
  update,
  view,
  webShowcaseNavigation,
} from './main'

const application = Runtime.makeApplication({
  Model,
  Flags: Todo.Flags,
  init,
  update,
  view,
  subscriptions,
  routing,
  resources: Layer.mergeAll(
    BrowserKeyValueStore.layerLocalStorage,
    animationHost.layer,
    webShowcaseNavigation,
  ),
  container: document.getElementById('root'),
  devTools: { Message },
})

Runtime.run(application, { flags: Todo.flags })
