import { Runtime } from 'foldkit'

import { BrowserKeyValueStore } from '@effect/platform-browser'

import { Flags, Message, Model, flags, init, update, view } from './main'

const application = Runtime.makeApplication({
  Model,
  Flags,
  init,
  update,
  view,
  resources: BrowserKeyValueStore.layerLocalStorage,
  container: document.getElementById('root'),
  devTools: {
    Message,
  },
})

Runtime.run(application, { flags })
