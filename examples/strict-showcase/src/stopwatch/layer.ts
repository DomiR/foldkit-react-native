import { toStrictHtml } from 'foldkit/strict/web'

import {
  EffectsLayer,
  StopwatchBlock,
  StopwatchComposition,
  init,
  subscriptions,
  update,
} from './block'
import { strictView } from './strictView'

export const layer = StopwatchBlock.makeLayer({
  init,
  update,
  view: StopwatchComposition.makeView((model, h) =>
    strictView(model, toStrictHtml(h)),
  ),
  subscriptions,
  EffectsLayer,
})
