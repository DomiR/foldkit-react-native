import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import {
  type BenchmarkLaunch,
  type DeviceInfo,
  launchBenchmark,
  preflight,
  readDeviceInfo,
} from './lib/launch.ts'
import {
  type BurstPayload,
  type LatencyPayload,
  type PerfPayload,
  isPayloadKind,
} from './lib/perfLog.ts'
import { type Summary, formatMs, summarize } from './lib/stats.ts'

const SHOWCASE_DIR = resolve(import.meta.dirname, '../..')
const DEFAULT_PORT = 8082
const DEFAULT_RUNS = 3
const DEFAULT_TIMEOUT_SECONDS = 180
const DEFAULT_PROFILE = 'default'
const MAX_CONSECUTIVE_FAILURES = 3
type LatencyPhase = Exclude<keyof LatencyPayload, 'kind' | 'i' | 'buildId'>

const LATENCY_PHASES: ReadonlyArray<LatencyPhase> = [
  'queue',
  'update',
  'frameWait',
  'view',
  'commit',
  'total',
]
const BURST_SIZES = [100, 1000, 10000]

type Options = Readonly<{
  serial: string
  port: number
  runs: number
  timeoutMs: number
  profile: string
  outPath: string
  buildId: string | undefined
}>

type BurstSample = Readonly<{
  run: number
  rep: number
  n: number
  totalMs: number
  dispatchLoopMs: number
  updates: number
  views: number
  commits: number
  updateMs: number
  viewMs: number
  maxViewMs: number
  countDelta: number
  updatesPerCommit: number | null
}>

type RawRun = Readonly<{
  run: number
  loadBefore?: number
  latency: ReadonlyArray<LatencyPayload>
  bursts: ReadonlyArray<BurstPayload>
  error?: string
}>

type BurstReport = Readonly<{
  n: number
  sampleCount: number
  totalMs: Summary
  messagesPerSecond: number
  dispatchLoopMs: Summary
  updates: Summary
  views: Summary
  commits: Summary
  updatesPerCommit: Summary
  updateMs: Summary
  viewMs: Summary
  maxViewMs: number
  countDeltaMismatches: ReadonlyArray<
    Readonly<{ run: number; rep: number; countDelta: number }>
  >
}>

type Report = Readonly<{
  profile: string
  options: Readonly<{
    port: number
    runs: number
    timeoutSeconds: number
  }>
  device: DeviceInfo
  runs: ReadonlyArray<RawRun>
  latency: Readonly<Record<LatencyPhase, Summary>>
  bursts: ReadonlyArray<BurstReport>
  staleRuns: number
}>

const parseInteger = (argument: string, value: string): number => {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      `${argument} requires a positive integer, received ${value}.`,
    )
  }
  return parsed
}

const parseArgs = (): Options => {
  let serial: string | undefined
  let port = DEFAULT_PORT
  let runs = DEFAULT_RUNS
  let timeoutSeconds = DEFAULT_TIMEOUT_SECONDS
  let profile = DEFAULT_PROFILE
  let outPath: string | undefined
  let buildId: string | undefined
  const args = process.argv.slice(2)

  for (let index = 0; index < args.length; index += 1) {
    const argument = args.at(index)
    const value = args.at(index + 1)
    if (argument === '--serial' && value !== undefined) {
      serial = value
      index += 1
    } else if (argument === '--port' && value !== undefined) {
      port = parseInteger(argument, value)
      index += 1
    } else if (argument === '--runs' && value !== undefined) {
      runs = parseInteger(argument, value)
      index += 1
    } else if (argument === '--timeout' && value !== undefined) {
      timeoutSeconds = parseInteger(argument, value)
      index += 1
    } else if (argument === '--profile' && value !== undefined) {
      profile = value
      index += 1
    } else if (argument === '--out' && value !== undefined) {
      outPath = resolve(process.cwd(), value)
      index += 1
    } else if (argument === '--build-id' && value !== undefined) {
      buildId = value
      index += 1
    } else {
      throw new Error(
        `Unknown or incomplete argument: ${argument ?? '<empty>'}`,
      )
    }
  }

  if (serial === undefined) {
    throw new Error('--serial is required.')
  }

  return {
    serial,
    port,
    runs,
    timeoutMs: timeoutSeconds * 1000,
    profile,
    outPath: outPath ?? join(SHOWCASE_DIR, '.perf', `bench-${profile}.json`),
    buildId,
  }
}

const payloadsFor = <Kind extends PerfPayload['kind']>(
  launch: BenchmarkLaunch,
  kind: Kind,
): Array<Extract<PerfPayload, { kind: Kind }>> =>
  launch.entries
    .filter(entry => isPayloadKind(entry, kind))
    .map(entry => entry.payload)

const burstSampleFromPayload = (
  run: number,
  payload: BurstPayload,
): BurstSample => {
  return {
    run,
    rep: payload.rep,
    n: payload.n,
    totalMs: payload.totalMs,
    dispatchLoopMs: payload.dispatchLoopMs,
    updates: payload.updates,
    views: payload.views,
    commits: payload.commits,
    updateMs: payload.updateMs,
    viewMs: payload.viewMs,
    maxViewMs: payload.maxViewMs,
    countDelta: payload.countDelta,
    updatesPerCommit:
      payload.commits === 0 ? null : payload.updates / payload.commits,
  }
}

const summarizeLatency = (
  runs: ReadonlyArray<RawRun>,
): Readonly<Record<LatencyPhase, Summary>> => {
  const values: Record<LatencyPhase, Array<number>> = {
    queue: [],
    update: [],
    frameWait: [],
    view: [],
    commit: [],
    total: [],
  }

  for (const run of runs) {
    for (const payload of run.latency) {
      for (const phase of LATENCY_PHASES) {
        values[phase].push(payload[phase])
      }
    }
  }

  return {
    queue: summarize(values.queue),
    update: summarize(values.update),
    frameWait: summarize(values.frameWait),
    view: summarize(values.view),
    commit: summarize(values.commit),
    total: summarize(values.total),
  }
}

const loadBeforeValues = (runs: ReadonlyArray<RawRun>): Array<number> => {
  const values: Array<number> = []
  for (const run of runs) {
    if (run.loadBefore !== undefined) {
      values.push(run.loadBefore)
    }
  }
  return values
}

const summarizeBursts = (runs: ReadonlyArray<RawRun>): Array<BurstReport> => {
  const grouped = new Map<number, Array<BurstSample>>()
  const mismatches = new Map<
    number,
    Array<Readonly<{ run: number; rep: number; countDelta: number }>>
  >()

  for (const run of runs) {
    for (const payload of run.bursts) {
      const sample = burstSampleFromPayload(run.run, payload)
      const samples = grouped.get(sample.n)
      if (samples === undefined) {
        grouped.set(sample.n, [sample])
      } else {
        samples.push(sample)
      }
      if (sample.countDelta !== sample.n) {
        const existing = mismatches.get(sample.n)
        const mismatch = {
          run: sample.run,
          rep: sample.rep,
          countDelta: sample.countDelta,
        }
        if (existing === undefined) {
          mismatches.set(sample.n, [mismatch])
        } else {
          existing.push(mismatch)
        }
      }
    }
  }

  return [...grouped]
    .sort((left, right) => {
      const [leftSize] = left
      const [rightSize] = right
      const leftOrder = BURST_SIZES.indexOf(leftSize)
      const rightOrder = BURST_SIZES.indexOf(rightSize)
      return (
        (leftOrder < 0 ? BURST_SIZES.length : leftOrder) -
        (rightOrder < 0 ? BURST_SIZES.length : rightOrder)
      )
    })
    .map(([n, samples]) => {
      const totalMs = summarize(samples.map(sample => sample.totalMs))
      return {
        n,
        sampleCount: samples.length,
        totalMs,
        messagesPerSecond:
          totalMs.median === 0 ? 0 : n / (totalMs.median / 1000),
        dispatchLoopMs: summarize(samples.map(sample => sample.dispatchLoopMs)),
        updates: summarize(samples.map(sample => sample.updates)),
        views: summarize(samples.map(sample => sample.views)),
        commits: summarize(samples.map(sample => sample.commits)),
        updatesPerCommit: summarize(
          samples.flatMap(sample =>
            sample.updatesPerCommit === null ? [] : [sample.updatesPerCommit],
          ),
        ),
        updateMs: summarize(samples.map(sample => sample.updateMs)),
        viewMs: summarize(samples.map(sample => sample.viewMs)),
        maxViewMs: Math.max(...samples.map(sample => sample.maxViewMs)),
        countDeltaMismatches: mismatches.get(n) ?? [],
      }
    })
}

const markdownReport = (report: Report): string => {
  const lines = [
    '# Foldkit render benchmark',
    '',
    `Profile: ${report.profile}`,
    `Android: ${report.device.androidRelease}`,
    `Model: ${report.device.model}`,
    `Device cores: ${report.device.cores}`,
    `Device memory: ${report.device.memoryKb} kB`,
    `Host CPU: ${report.device.hostCpu}`,
    `Stale runs: ${report.staleRuns}`,
    `Median load before run: ${summarize(loadBeforeValues(report.runs)).median.toFixed(2)}`,
    '',
    '## Latency',
    '',
    '| Phase | Median | P95 | Max | N |',
    '| --- | ---: | ---: | ---: | ---: |',
  ]
  for (const [phase, summary] of Object.entries(report.latency)) {
    lines.push(
      `| ${phase} | ${formatMs(summary.median)} | ${formatMs(summary.p95)} | ${formatMs(summary.max)} | ${summary.count} |`,
    )
  }

  lines.push(
    '',
    '## Bursts',
    '',
    '| Messages | Samples | Median total | Messages/s | Median dispatch loop | Median updates | Median views | Median commits | Updates/commit | Median update | Median view | Max view | Count mismatches |',
    '| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  )
  for (const burst of report.bursts) {
    const mismatchText =
      burst.countDeltaMismatches.length === 0
        ? 'none'
        : burst.countDeltaMismatches
            .map(
              mismatch =>
                `${mismatch.run}/${mismatch.rep}=${mismatch.countDelta}`,
            )
            .join(', ')
    lines.push(
      `| ${burst.n} | ${burst.sampleCount} | ${formatMs(burst.totalMs.median)} | ${burst.messagesPerSecond.toFixed(1)} | ${formatMs(burst.dispatchLoopMs.median)} | ${burst.updates.median.toFixed(1)} | ${burst.views.median.toFixed(1)} | ${burst.commits.median.toFixed(1)} | ${burst.updatesPerCommit.median.toFixed(2)} | ${formatMs(burst.updateMs.median)} | ${formatMs(burst.viewMs.median)} | ${formatMs(burst.maxViewMs)} | ${mismatchText} |`,
    )
  }

  return `${lines.join('\n')}\n`
}

const writeReport = (report: Report, outPath: string): void => {
  const markdown = markdownReport(report)
  const markdownPath = outPath.endsWith('.json')
    ? outPath.replace(/\.json$/i, '.md')
    : `${outPath}.md`
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`)
  writeFileSync(markdownPath, markdown)
  process.stdout.write(markdown)
}

const run = async (options: Options): Promise<void> => {
  await preflight(options)
  const device = readDeviceInfo(options.serial)
  const rawRuns: Array<RawRun> = []
  let consecutiveFailures = 0
  let staleRuns = 0

  for (let runNumber = 1; runNumber <= options.runs; runNumber += 1) {
    let failureRecorded = false
    try {
      const launch = await launchBenchmark(options)

      const staleEntry =
        options.buildId === undefined
          ? undefined
          : launch.entries.find(
              entry => entry.payload.buildId !== options.buildId,
            )
      if (staleEntry !== undefined) {
        staleRuns += 1
        consecutiveFailures += 1
        const message = `stale bundle ${staleEntry.payload.buildId} expected ${options.buildId}`
        rawRuns.push({
          run: runNumber,
          latency: [],
          bursts: [],
          error: message,
        })
        failureRecorded = true
        process.stderr.write(`Run ${runNumber} failed: ${message}\n`)
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          throw new Error(
            `Aborting after ${consecutiveFailures} consecutive benchmark failures.`,
          )
        }
        continue
      }

      if (launch.benchError !== undefined) {
        throw new Error(
          `The app reported benchError: ${launch.benchError.message}`,
        )
      }

      consecutiveFailures = 0
      rawRuns.push({
        run: runNumber,
        loadBefore: launch.loadBefore,
        latency: payloadsFor(launch, 'latency'),
        bursts: payloadsFor(launch, 'burst'),
      })
      process.stderr.write(`Run ${runNumber} completed.\n`)
    } catch (error) {
      if (!failureRecorded) {
        consecutiveFailures += 1
        const message = String(error)
        rawRuns.push({
          run: runNumber,
          latency: [],
          bursts: [],
          error: message,
        })
        process.stderr.write(`Run ${runNumber} failed: ${message}\n`)
      }
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        throw new Error(
          `Aborting after ${consecutiveFailures} consecutive benchmark failures.`,
        )
      }
    }
  }

  const report: Report = {
    profile: options.profile,
    options: {
      port: options.port,
      runs: options.runs,
      timeoutSeconds: options.timeoutMs / 1000,
    },
    device,
    runs: rawRuns,
    latency: summarizeLatency(rawRuns),
    bursts: summarizeBursts(rawRuns),
    staleRuns,
  }
  if (report.bursts.length === 0 && report.latency.total.count === 0) {
    throw new Error('No benchmark payloads were collected.')
  }
  writeReport(report, options.outPath)
}

run(parseArgs()).catch(error => {
  console.error(String(error))
  process.exitCode = 1
})
