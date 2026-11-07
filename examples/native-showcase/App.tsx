import { Layer, Option } from 'effect'
import { KeyValueStore } from 'effect/persistence'
import { makeShowcaseLayer } from 'strict-showcase-example/layer'
import { nativeShowcaseNavigation } from 'strict-showcase-example/navigation'
import { Message, ShowcaseBlock } from 'strict-showcase-example/showcase'
import { showcaseStrictView } from 'strict-showcase-example/showcaseStrictView'

import {
  FoldkitRoot,
  makeNativeAnimationHost,
  makeNativeProgram,
} from '@foldkit/native'

import {
  buildId,
  bundleEvaluationStartedAt,
  isPerfEnabled,
} from './src/perf/bundleStart'
import { makePerfHarness } from './src/perf/harness'

const animationHost = makeNativeAnimationHost()

const maybePerfHarness = isPerfEnabled
  ? Option.fromNullishOr(bundleEvaluationStartedAt).pipe(
      Option.map(timestamp => makePerfHarness(timestamp, buildId)),
    )
  : Option.none()

if (Option.isSome(maybePerfHarness)) {
  maybePerfHarness.value.markModulesEvaluated()
}

const program = makeNativeProgram({
  id: 'native-showcase',
  block: ShowcaseBlock,
  layer: makeShowcaseLayer(),
  animationHost,
  routing: {
    onUrlRequest: request => Message.ClickedLink({ request }),
    onUrlChange: url => Message.ChangedUrl({ url }),
  },
  resources: Layer.merge(KeyValueStore.layerMemory, nativeShowcaseNavigation),
  view: showcaseStrictView,
  devTools:
    process.env.EXPO_PUBLIC_FOLDKIT_DEVTOOLS === '1'
      ? {
          name: 'Native Showcase',
          ...(process.env.EXPO_PUBLIC_FOLDKIT_DEVTOOLS_HOST !== undefined && {
            relayHost: process.env.EXPO_PUBLIC_FOLDKIT_DEVTOOLS_HOST,
          }),
          ...(process.env.EXPO_PUBLIC_FOLDKIT_DEVTOOLS_PORT !== undefined && {
            relayPort: Number(process.env.EXPO_PUBLIC_FOLDKIT_DEVTOOLS_PORT),
          }),
        }
      : false,
  ...(Option.isNone(maybePerfHarness)
    ? {}
    : { instrumentation: maybePerfHarness.value.instrumentation }),
})

if (Option.isSome(maybePerfHarness)) {
  maybePerfHarness.value.markProgramCreated()
  maybePerfHarness.value.start(program)
}

export default function App() {
  return <FoldkitRoot program={program} />
}
