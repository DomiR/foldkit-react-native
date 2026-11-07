import { Layer } from 'effect'
import { toStrictHtml } from 'foldkit/strict/web'

import {
  GenerateTodo,
  SaveTodos,
  TodoBlock,
  TodoComposition,
  init,
  update,
} from './block'
import { strictView } from './strictView'

export const layer = TodoBlock.makeLayer({
  init,
  update,
  view: TodoComposition.makeView((model, h) =>
    strictView(model, toStrictHtml(h)),
  ),
  EffectsLayer: Layer.mergeAll(GenerateTodo.layer, SaveTodos.layer),
})
