import { toStrictHtml } from 'foldkit/strict/web'

import {
  AnimationsBlock,
  AnimationsComposition,
  EffectsLayer,
  init,
  subscriptions,
  update,
} from './block'
import { strictView } from './strictView'

export const layer = AnimationsBlock.makeLayer({
  init,
  update,
  view: AnimationsComposition.makeView((model, h) =>
    strictView(model, toStrictHtml(h)),
  ),
  subscriptions,
  EffectsLayer,
})
