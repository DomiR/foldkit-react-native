import { Array, Option, Predicate } from 'effect'
import * as Showcase from 'strict-showcase-example/showcase'

import type {
  NativeChild,
  NativeInstrumentation,
  NativeProgram,
} from '@foldkit/native'

declare const performance: Readonly<{ now: () => number }>

const findIncrement = (
  child: NativeChild<Showcase.Message>,
): Option.Option<Showcase.Message> => {
  if (child === null || Predicate.isString(child)) {
    return Option.none()
  }

  if (child._tag === 'Lazy') {
    return findIncrement(child.node)
  }

  if (child._tag === 'Stack') {
    return Array.findFirst(child.screens, screen =>
      Array.findFirst(screen.children, findIncrement),
    )
  }

  if (child._tag === 'Tabs') {
    return Array.findFirst(child.tabs, tab =>
      Array.findFirst(tab.children, findIncrement),
    )
  }

  if (child._tag !== 'Element') {
    return Option.none()
  }

  if (
    child.attributes.ariaLabel === 'Increment' &&
    child.attributes.onClick !== undefined
  ) {
    return Option.some(child.attributes.onClick)
  }

  return Array.findFirst(child.children, findIncrement)
}

// NOTE: the harness presses the rendered Increment button's Message, which
// carries the live counter occurrence's generation.
const clickedCounterIncrement = (
  program: NativeProgram<Showcase.Model, Showcase.Message>,
): Showcase.Message =>
  Option.getOrThrowWith(
    findIncrement(program.getSnapshot()),
    () => new Error('The Counter screen is not rendered.'),
  )

const DECIMAL_PLACES = 3
const ROUNDING_FACTOR = 10 ** DECIMAL_PLACES
const WAIT_TIMEOUT_MS = 60_000
const STARTUP_WAIT_MS = 2_000
const SCREEN_WAIT_MS = 1_500
const LATENCY_SAMPLE_COUNT = 200
const BURST_REPETITIONS = 5
const BURST_PAUSE_MS = 500
const PHASE_STEP_MS = 7
const FRAME_PHASE_COUNT = 17
const REQUEST_ANIMATION_FRAME_COUNT = 2
const ERROR_MESSAGE_MAX_LENGTH = 240
const BURST_SIZES: ReadonlyArray<number> = [100, 1_000, 10_000]

type StartupTiming = Readonly<{
  startTime: number | null
  initializeRuntimeStart: number | null
  executeJavaScriptBundleEntryPointStart: number | null
}>

type UpdateTiming = Readonly<{
  startedAt: number
  endedAt: number
}>

type ViewTiming = Readonly<{
  startedAt: number
  endedAt: number
}>

type LatencyResult = Readonly<{
  index: number
  dispatchedAt: number
  update: UpdateTiming
  view: ViewTiming
  committedAt: number
}>

type LatencySample = {
  readonly index: number
  readonly dispatchedAt: number
  maybeUpdate: Option.Option<UpdateTiming>
  maybeView: Option.Option<ViewTiming>
  maybeTimeoutId: Option.Option<ReturnType<typeof setTimeout>>
  resolve: (result: LatencyResult) => void
  reject: (error: unknown) => void
}

type Burst = {
  readonly size: number
  readonly repetition: number
  readonly startedAt: number
  readonly beforeCount: number
  readonly getCount: () => number
  dispatchLoopMs: number
  updates: number
  views: number
  commits: number
  updateMs: number
  viewMs: number
  maxViewMs: number
  maybeNthUpdateEndedAt: Option.Option<number>
  maybeCompletionViewEndedAt: Option.Option<number>
  maybeTimeoutId: Option.Option<ReturnType<typeof setTimeout>>
  resolve: () => void
  reject: (error: unknown) => void
}

type PayloadValue = string | number | null

const roundMilliseconds = (milliseconds: number): number =>
  Math.round(milliseconds * ROUNDING_FACTOR) / ROUNDING_FACTOR

const emptyStartupTiming: StartupTiming = {
  startTime: null,
  initializeRuntimeStart: null,
  executeJavaScriptBundleEntryPointStart: null,
}

const readStartupTiming = (): StartupTiming => {
  const timing: unknown = Reflect.get(performance, 'rnStartupTiming')
  if (!Predicate.isObject(timing)) {
    return emptyStartupTiming
  }

  const startTime = Reflect.get(timing, 'startTime')
  const initializeRuntimeStart = Reflect.get(timing, 'initializeRuntimeStart')
  const executeJavaScriptBundleEntryPointStart = Reflect.get(
    timing,
    'executeJavaScriptBundleEntryPointStart',
  )

  return {
    startTime: Predicate.isNumber(startTime) ? startTime : null,
    initializeRuntimeStart: Predicate.isNumber(initializeRuntimeStart)
      ? initializeRuntimeStart
      : null,
    executeJavaScriptBundleEntryPointStart: Predicate.isNumber(
      executeJavaScriptBundleEntryPointStart,
    )
      ? executeJavaScriptBundleEntryPointStart
      : null,
  }
}

const waitForPromise = async <Value>(
  promise: Promise<Value>,
  description: string,
): Promise<Value> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Timed out waiting for ${description}.`))
    }, WAIT_TIMEOUT_MS)
  })

  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId)
    }
  }
}

const waitForDelay = (delayMs: number, description: string): Promise<void> =>
  waitForPromise(
    new Promise<void>(resolve => {
      setTimeout(resolve, delayMs)
    }),
    description,
  )

const waitForAnimationFrames = (): Promise<void> => {
  let frameCount = 0
  const frames = new Promise<void>(resolve => {
    const waitForNextFrame = (): void => {
      frameCount += 1
      if (frameCount === REQUEST_ANIMATION_FRAME_COUNT) {
        resolve()
      } else {
        requestAnimationFrame(waitForNextFrame)
      }
    }

    requestAnimationFrame(waitForNextFrame)
  })

  return waitForPromise(frames, 'animation frames')
}

export const makePerfHarness = (
  bundleEvaluationStartedAt: number,
  buildId: string | undefined,
) => {
  const logPayload = (
    payload: Readonly<Record<string, PayloadValue>>,
  ): void => {
    console.log(
      'FOLDKIT_PERF ' +
        JSON.stringify({ buildId: buildId ?? null, ...payload }),
    )
  }

  let maybeModulesEvaluatedAt = Option.none<number>()
  let maybeProgramCreatedAt = Option.none<number>()
  let maybeFirstView = Option.none<ViewTiming>()
  let maybeFirstCommit = Option.none<number>()
  let maybeLatencySample = Option.none<LatencySample>()
  let maybeBurst = Option.none<Burst>()
  let maybeResolveFirstCommit = Option.none<(committedAt: number) => void>()

  const firstCommit = new Promise<number>(resolve => {
    maybeResolveFirstCommit = Option.some(resolve)
  })

  const onUpdate = (startedAt: number, endedAt: number): void => {
    if (Option.isSome(maybeLatencySample)) {
      const latencySample = maybeLatencySample.value
      if (
        Option.isNone(latencySample.maybeUpdate) &&
        startedAt >= latencySample.dispatchedAt
      ) {
        latencySample.maybeUpdate = Option.some({ startedAt, endedAt })
      }
    }

    if (Option.isSome(maybeBurst)) {
      const burst = maybeBurst.value
      if (startedAt < burst.startedAt) {
        return
      }

      burst.updates += 1
      burst.updateMs += endedAt - startedAt
      if (burst.updates === burst.size) {
        burst.maybeNthUpdateEndedAt = Option.some(endedAt)
      }
    }
  }

  const onView = (startedAt: number, endedAt: number): void => {
    if (Option.isNone(maybeFirstView)) {
      maybeFirstView = Option.some({ startedAt, endedAt })
    }

    if (Option.isSome(maybeLatencySample)) {
      const latencySample = maybeLatencySample.value
      if (Option.isSome(latencySample.maybeUpdate)) {
        const update = latencySample.maybeUpdate.value
        if (
          Option.isNone(latencySample.maybeView) &&
          startedAt >= update.endedAt
        ) {
          latencySample.maybeView = Option.some({ startedAt, endedAt })
        }
      }
    }

    if (Option.isSome(maybeBurst)) {
      const burst = maybeBurst.value
      if (startedAt < burst.startedAt) {
        return
      }

      const viewMs = endedAt - startedAt
      burst.views += 1
      burst.viewMs += viewMs
      burst.maxViewMs = Math.max(burst.maxViewMs, viewMs)

      if (
        Option.isSome(burst.maybeNthUpdateEndedAt) &&
        Option.isNone(burst.maybeCompletionViewEndedAt) &&
        startedAt >= burst.maybeNthUpdateEndedAt.value
      ) {
        burst.maybeCompletionViewEndedAt = Option.some(endedAt)
      }
    }
  }

  const onCommit = (committedAt: number): void => {
    if (Option.isNone(maybeFirstCommit)) {
      const firstView = Option.getOrThrow(maybeFirstView)
      const startupTiming = readStartupTiming()
      logPayload({
        kind: 'startup',
        rnStartTime:
          startupTiming.startTime === null
            ? null
            : roundMilliseconds(startupTiming.startTime),
        rnInitRuntimeStart:
          startupTiming.initializeRuntimeStart === null
            ? null
            : roundMilliseconds(startupTiming.initializeRuntimeStart),
        rnEntryPointStart:
          startupTiming.executeJavaScriptBundleEntryPointStart === null
            ? null
            : roundMilliseconds(
                startupTiming.executeJavaScriptBundleEntryPointStart,
              ),
        bundleEvalStart: roundMilliseconds(bundleEvaluationStartedAt),
        modulesEvaluated: roundMilliseconds(
          Option.getOrThrow(maybeModulesEvaluatedAt),
        ),
        programCreated: roundMilliseconds(
          Option.getOrThrow(maybeProgramCreatedAt),
        ),
        firstViewStart: roundMilliseconds(firstView.startedAt),
        firstViewEnd: roundMilliseconds(firstView.endedAt),
        firstCommit: roundMilliseconds(committedAt),
      })
      maybeFirstCommit = Option.some(committedAt)
      if (Option.isSome(maybeResolveFirstCommit)) {
        maybeResolveFirstCommit.value(committedAt)
        maybeResolveFirstCommit = Option.none()
      }
    }

    if (Option.isSome(maybeLatencySample)) {
      const latencySample = maybeLatencySample.value
      if (
        Option.isSome(latencySample.maybeUpdate) &&
        Option.isSome(latencySample.maybeView)
      ) {
        const update = latencySample.maybeUpdate.value
        const view = latencySample.maybeView.value
        if (committedAt >= view.endedAt) {
          maybeLatencySample = Option.none()
          if (Option.isSome(latencySample.maybeTimeoutId)) {
            clearTimeout(latencySample.maybeTimeoutId.value)
          }
          latencySample.resolve({
            index: latencySample.index,
            dispatchedAt: latencySample.dispatchedAt,
            update,
            view,
            committedAt,
          })
        }
      }
    }

    if (Option.isSome(maybeBurst)) {
      const burst = maybeBurst.value
      burst.commits += 1
      if (
        Option.isSome(burst.maybeCompletionViewEndedAt) &&
        committedAt >= burst.maybeCompletionViewEndedAt.value
      ) {
        maybeBurst = Option.none()
        if (Option.isSome(burst.maybeTimeoutId)) {
          clearTimeout(burst.maybeTimeoutId.value)
        }
        logPayload({
          kind: 'burst',
          n: burst.size,
          rep: burst.repetition,
          totalMs: roundMilliseconds(committedAt - burst.startedAt),
          dispatchLoopMs: roundMilliseconds(burst.dispatchLoopMs),
          updates: burst.updates,
          views: burst.views,
          commits: burst.commits,
          updateMs: roundMilliseconds(burst.updateMs),
          viewMs: roundMilliseconds(burst.viewMs),
          maxViewMs: roundMilliseconds(burst.maxViewMs),
          countDelta: burst.getCount() - burst.beforeCount,
        })
        burst.resolve()
      }
    }
  }

  const instrumentation: NativeInstrumentation = {
    onUpdate,
    onView,
    onCommit,
  }

  const measureLatency = (
    program: NativeProgram<Showcase.Model, Showcase.Message>,
    index: number,
  ): Promise<LatencyResult> => {
    const dispatchedAt = performance.now()
    const latencyPromise = new Promise<LatencyResult>((resolve, reject) => {
      const latencySample: LatencySample = {
        index,
        dispatchedAt,
        maybeUpdate: Option.none(),
        maybeView: Option.none(),
        maybeTimeoutId: Option.none(),
        resolve,
        reject,
      }
      latencySample.maybeTimeoutId = Option.some(
        setTimeout(() => {
          maybeLatencySample = Option.none()
          reject(
            new Error(
              `Latency timeout i=${index} updateSeen=${Option.isSome(latencySample.maybeUpdate)} viewSeen=${Option.isSome(latencySample.maybeView)}`,
            ),
          )
        }, WAIT_TIMEOUT_MS),
      )
      maybeLatencySample = Option.some(latencySample)
    })

    try {
      program.dispatch(clickedCounterIncrement(program))
    } catch (error) {
      maybeLatencySample = Option.none()
      throw error
    }

    return latencyPromise
  }

  const runBurst = (
    program: NativeProgram<Showcase.Model, Showcase.Message>,
    size: number,
    repetition: number,
  ): Promise<void> => {
    const startedAt = performance.now()
    const burstPromise = new Promise<void>((resolve, reject) => {
      const burst: Burst = {
        size,
        repetition,
        startedAt,
        beforeCount: program.getModel().counter.count,
        getCount: () => program.getModel().counter.count,
        dispatchLoopMs: 0,
        updates: 0,
        views: 0,
        commits: 0,
        updateMs: 0,
        viewMs: 0,
        maxViewMs: 0,
        maybeNthUpdateEndedAt: Option.none(),
        maybeCompletionViewEndedAt: Option.none(),
        maybeTimeoutId: Option.none(),
        resolve,
        reject,
      }
      burst.maybeTimeoutId = Option.some(
        setTimeout(() => {
          maybeBurst = Option.none()
          reject(
            new Error(
              `Burst timeout n=${size} rep=${repetition} updates=${burst.updates} views=${burst.views} commits=${burst.commits} nthUpdateSeen=${Option.isSome(burst.maybeNthUpdateEndedAt)} completionViewSeen=${Option.isSome(burst.maybeCompletionViewEndedAt)} elapsedMs=${roundMilliseconds(performance.now() - burst.startedAt)}`,
            ),
          )
        }, WAIT_TIMEOUT_MS),
      )
      maybeBurst = Option.some(burst)

      for (let dispatchIndex = 0; dispatchIndex < size; dispatchIndex += 1) {
        program.dispatch(clickedCounterIncrement(program))
      }

      burst.dispatchLoopMs = performance.now() - startedAt
    })

    return burstPromise
  }

  const start = (
    program: NativeProgram<Showcase.Model, Showcase.Message>,
  ): void => {
    void (async () => {
      try {
        await waitForPromise(firstCommit, 'first commit')
        await waitForDelay(STARTUP_WAIT_MS, 'startup delay')
        program.dispatch(
          Showcase.Message.PressedExampleRow({ example: 'Counter' }),
        )
        await waitForDelay(SCREEN_WAIT_MS, 'counter screen')

        for (
          let sampleIndex = 0;
          sampleIndex < LATENCY_SAMPLE_COUNT;
          sampleIndex += 1
        ) {
          await waitForAnimationFrames()
          const phaseDelayMs = (sampleIndex * PHASE_STEP_MS) % FRAME_PHASE_COUNT
          await waitForDelay(phaseDelayMs, 'latency sample delay')
          const result = await measureLatency(program, sampleIndex)
          logPayload({
            kind: 'latency',
            i: result.index,
            queue: roundMilliseconds(
              result.update.startedAt - result.dispatchedAt,
            ),
            update: roundMilliseconds(
              result.update.endedAt - result.update.startedAt,
            ),
            frameWait: roundMilliseconds(
              result.view.startedAt - result.update.endedAt,
            ),
            view: roundMilliseconds(
              result.view.endedAt - result.view.startedAt,
            ),
            commit: roundMilliseconds(result.committedAt - result.view.endedAt),
            total: roundMilliseconds(result.committedAt - result.dispatchedAt),
          })
        }

        let isFirstBurst = true
        for (const burstSize of BURST_SIZES) {
          for (
            let repetition = 0;
            repetition < BURST_REPETITIONS;
            repetition += 1
          ) {
            if (!isFirstBurst) {
              await waitForDelay(BURST_PAUSE_MS, 'burst pause')
            }
            isFirstBurst = false
            await runBurst(program, burstSize, repetition)
          }
        }

        logPayload({ kind: 'benchDone' })
      } catch (error) {
        maybeLatencySample = Option.none()
        maybeBurst = Option.none()
        const message =
          error instanceof Error ? error.message : globalThis.String(error)
        logPayload({
          kind: 'benchError',
          message: message
            .replaceAll(/["\\\r\n]/g, ' ')
            .slice(0, ERROR_MESSAGE_MAX_LENGTH),
        })
      }
    })()
  }

  return {
    instrumentation,
    markModulesEvaluated: () => {
      maybeModulesEvaluatedAt = Option.some(performance.now())
    },
    markProgramCreated: () => {
      maybeProgramCreatedAt = Option.some(performance.now())
    },
    start,
  }
}
