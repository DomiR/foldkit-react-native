import { Layer } from 'effect'
import { type WebAnimationHost, toStrictHtml } from 'foldkit/strict/web'

import { layer as animationsLayer } from './animations/layer'
import { layer as chatLayer } from './chat/layer'
import { layer as contactsLayer } from './contacts/layer'
import { layer as counterLayer } from './counter/layer'
import { layer as formLayer } from './form/layer'
import {
  PushUrl,
  ReplaceUrl,
  ShowcaseBlock,
  ShowcaseComposition,
  init,
  update,
} from './showcase'
import { showcaseStrictView } from './showcaseStrictView'
import { layer as stopwatchLayer } from './stopwatch/layer'
import { layer as todoLayer } from './todo/layer'

const childLayers = Layer.mergeAll(
  counterLayer,
  stopwatchLayer,
  todoLayer,
  formLayer,
  contactsLayer,
  chatLayer,
  animationsLayer,
)

/** Completes the showcase Block. A web host passes its animation host so the
 * web view can run strict animations; native renders its own view. */
export const makeShowcaseLayer = (animationHost?: WebAnimationHost) =>
  ShowcaseBlock.makeLayer({
    init,
    update,
    view: ShowcaseComposition.makeView((model, h) => ({
      title: `${model.tabs} | Strict showcase | Foldkit`,
      body: showcaseStrictView(model, toStrictHtml(h, animationHost)),
    })),
    EffectsLayer: Layer.mergeAll(PushUrl.layer, ReplaceUrl.layer),
  }).pipe(Layer.provide(childLayers))
