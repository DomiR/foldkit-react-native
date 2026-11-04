import { Layer, Option } from 'effect'
import { KeyValueStore } from 'effect/persistence'
import { nativeShowcaseNavigation } from 'strict-showcase-example/navigation'
import {
  Model,
  init,
  routing,
  subscriptions,
  update,
} from 'strict-showcase-example/showcase'
import { showcaseStrictView } from 'strict-showcase-example/showcaseStrictView'
import * as Todo from 'todo-example/program'

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
  Model,
  init: url => init(Todo.Flags.make({ todos: Option.none() }), url),
  update,
  subscriptions,
  animationHost,
  routing,
  resources: Layer.merge(KeyValueStore.layerMemory, nativeShowcaseNavigation),
  view: showcaseStrictView,
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
