import type { Document, HtmlBuilder } from 'foldkit/html'
import { makeWebAnimationHost, toStrictHtml } from 'foldkit/strict/web'

import { type Message, type Model } from './showcase'
import { showcaseStrictView } from './showcaseStrictView'

export {
  Message,
  Model,
  init,
  routing,
  subscriptions,
  update,
} from './showcase'
export { webShowcaseNavigation } from './navigation'

export const animationHost = makeWebAnimationHost()

export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: `${model.tabs} | Strict showcase | Foldkit`,
  body: showcaseStrictView(model, toStrictHtml(h, animationHost)),
})
