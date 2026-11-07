import { toStrictHtml } from 'foldkit/strict/web'

import { ChatBlock, ChatComposition, init, update } from './block'
import { strictView } from './strictView'

export const layer = ChatBlock.makeLayer({
  init,
  update,
  view: ChatComposition.makeView((model, h) =>
    strictView(model, toStrictHtml(h)),
  ),
})
