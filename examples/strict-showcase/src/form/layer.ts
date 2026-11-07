import { toStrictHtml } from 'foldkit/strict/web'

import { EffectsLayer, FormBlock, FormComposition, init, update } from './block'
import { strictView } from './strictView'

export const layer = FormBlock.makeLayer({
  init,
  update,
  view: FormComposition.makeView((model, h) =>
    strictView(model, toStrictHtml(h)),
  ),
  EffectsLayer,
})
