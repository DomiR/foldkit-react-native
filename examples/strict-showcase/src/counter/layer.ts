import { toStrictHtml } from 'foldkit/strict/web'

import { CounterBlock, CounterComposition, init, update } from './block'
import { strictView } from './strictView'

export const layer = CounterBlock.makeLayer({
  init,
  update,
  view: CounterComposition.makeView((model, h) =>
    strictView(model, toStrictHtml(h)),
  ),
})
