import { Layer } from 'effect'
import { Program, Runtime } from 'foldkit'
import { makeWebAnimationHost } from 'foldkit/strict/web'

import { BrowserKeyValueStore } from '@effect/platform-browser'

import { makeShowcaseLayer } from './layer'
import { webShowcaseNavigation } from './navigation'
import { ShowcaseBlock } from './showcase'

const animationHost = makeWebAnimationHost()

const program = Program.make({
  block: ShowcaseBlock,
  layer: makeShowcaseLayer(animationHost),
  container: document.getElementById('root'),
  routing: {
    onUrlRequest: ShowcaseBlock.Message.ClickedLink,
    onUrlChange: ShowcaseBlock.Message.ChangedUrl,
  },
  devTools: { dispatch: true },
}).provide(
  Layer.mergeAll(
    BrowserKeyValueStore.layerLocalStorage,
    animationHost.layer,
    webShowcaseNavigation,
  ),
)

Runtime.run(program)
