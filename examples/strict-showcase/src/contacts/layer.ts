import { toStrictHtml } from 'foldkit/strict/web'

import {
  ContactsBlock,
  ContactsComposition,
  EffectsLayer,
  init,
  update,
} from './block'
import { strictView } from './strictView'

export const layer = ContactsBlock.makeLayer({
  init,
  update,
  view: ContactsComposition.makeView((model, h) =>
    strictView(model, toStrictHtml(h)),
  ),
  EffectsLayer,
})
