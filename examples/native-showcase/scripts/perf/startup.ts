import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import {
  type DeviceInfo,
  type StartupLaunch,
  launchStartup,
  preflight,
  readDeviceInfo,
} from './lib/launch.ts'
import type { StartupPayload } from './lib/perfLog.ts'
import { type Summary, formatMs, summarize } from './lib/stats.ts'

const SHOWCASE_DIR = resolve(import.meta.dirname, '../..')
const DEFAULT_PORT = 8082
const DEFAULT_RUNS = 10
const DEFAULT_WARMUP = 1
const DEFAULT_TIMEOUT_SECONDS = 90
const DEFAULT_PROFILE = 'default'
const MAX_CONSECUTIVE_FAILURES = 3

type Options = Readonly<{
  serial: string
  port: number
  runs: number
  warmup: number
  timeoutMs: number
  profile: string
  outPath: string
  buildId: string | undefined
}>

type StartupMetrics = Readonly<Record<string, number | null>>

type RawRun = Readonly<{
  run: number
  loadBefore?: number
  metrics?: StartupMetrics
  startup?: StartupPayload
  startupLogEpochMs?: number
  intentStartEpochMs?: number
  intentTotalTime?: number
  intentWaitTime?: number
  error?: string
}>

type Report = Readonly<{
  profile: string
  options: Readonly<{
    port: number
    runs: number
    warmup: number
    timeoutSeconds: number
  }>
  device: DeviceInfo
  runs: ReadonlyArray<RawRun>
  summary: Readonly<Record<string, Summary>>
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
  let warmup = DEFAULT_WARMUP
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
    } else if (argument === '--warmup' && value !== undefined) {
      warmup = Number.parseInt(value, 10)
      if (!Number.isInteger(warmup) || warmup < 0) {
        throw new Error(
          `--warmup requires a non-negative integer, received ${value}.`,
        )
      }
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
    warmup,
    timeoutMs: timeoutSeconds * 1000,
    profile,
    outPath: outPath ?? join(SHOWCASE_DIR, '.perf', `startup-${profile}.json`),
    buildId,
  }
}

const subtract = (left: number | null, right: number | null): number | null =>
  left === null || right === null ? null : left - right

const metricsFromLaunch = (launch: StartupLaunch): StartupMetrics => {
  const payload = launch.startup.payload
  const {
    rnInitRuntimeStart,
    rnEntryPointStart,
    bundleEvalStart,
    modulesEvaluated,
    programCreated,
    firstViewStart,
    firstViewEnd,
    firstCommit,
  } = payload
  const intentToFirstCommit =
    launch.intentStartMs === undefined
      ? null
      : launch.startup.epochMs - launch.intentStartMs

  return {
    loadBefore: launch.loadBefore,
    intentToFirstCommit,
    entryPointToFirstCommit: subtract(firstCommit, rnEntryPointStart),
    runtimeInitToEntryPoint: subtract(rnEntryPointStart, rnInitRuntimeStart),
    entryPointToBundleEval: subtract(bundleEvalStart, rnEntryPointStart),
    moduleEvaluation: subtract(modulesEvaluated, bundleEvalStart),
    programCreation: subtract(programCreated, modulesEvaluated),
    modulesEvaluatedToFirstView: subtract(firstViewStart, modulesEvaluated),
    firstView: subtract(firstViewEnd, firstViewStart),
    firstViewToCommit: subtract(firstCommit, firstViewEnd),
    bundleEvalToFirstCommit: subtract(firstCommit, bundleEvalStart),
    amStartTotalTime: launch.intent.totalTime ?? null,
  }
}

const successfulMetrics = (
  runs: ReadonlyArray<RawRun>,
): Readonly<Record<string, Array<number>>> => {
  const values = new Map<string, Array<number>>()
  for (const run of runs) {
    if (run.metrics === undefined) {
      continue
    }
    for (const [name, value] of Object.entries(run.metrics)) {
      if (value !== null) {
        const existing = values.get(name)
        if (existing === undefined) {
          values.set(name, [value])
        } else {
          existing.push(value)
        }
      }
    }
  }
  return Object.fromEntries(values)
}

const markdownReport = (report: Report): string => {
  const lines = [
    '# Foldkit startup measurement',
    '',
    `Profile: ${report.profile}`,
    `Android: ${report.device.androidRelease}`,
    `Model: ${report.device.model}`,
    `Device cores: ${report.device.cores}`,
    `Device memory: ${report.device.memoryKb} kB`,
    `Host CPU: ${report.device.hostCpu}`,
    `Stale runs: ${report.staleRuns}`,
    '',
    '| Metric | Median | P90 | Min | Max | N |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
  ]

  for (const [name, summary] of Object.entries(report.summary)) {
    const formatSummaryValue = (value: number): string =>
      name === 'loadBefore' ? value.toFixed(2) : formatMs(value)
    lines.push(
      `| ${name} | ${formatSummaryValue(summary.median)} | ${formatSummaryValue(summary.p90)} | ${formatSummaryValue(summary.min)} | ${formatSummaryValue(summary.max)} | ${summary.count} |`,
    )
  }

  return `${lines.join('\n')}\n`
}

const rawRunFromLaunch = (run: number, launch: StartupLaunch): RawRun => {
  const rawRun: {
    run: number
    loadBefore: number
    metrics: StartupMetrics
    startup: StartupPayload
    startupLogEpochMs: number
    intentTotalTime?: number
    intentWaitTime?: number
    intentStartEpochMs?: number
  } = {
    run,
    loadBefore: launch.loadBefore,
    metrics: metricsFromLaunch(launch),
    startup: launch.startup.payload,
    startupLogEpochMs: launch.startup.epochMs,
  }
  if (launch.intent.totalTime !== undefined) {
    rawRun.intentTotalTime = launch.intent.totalTime
  }
  if (launch.intent.waitTime !== undefined) {
    rawRun.intentWaitTime = launch.intent.waitTime
  }
  if (launch.intentStartMs !== undefined) {
    rawRun.intentStartEpochMs = launch.intentStartMs
  }
  return rawRun
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
  const totalAttempts = options.warmup + options.runs

  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    const isWarmup = attempt <= options.warmup
    const runNumber = isWarmup ? 0 : attempt - options.warmup
    let failureRecorded = false
    try {
      const launch = await launchStartup(options)

      const staleReason =
        options.buildId === undefined ||
        launch.startup.payload.buildId === options.buildId
          ? undefined
          : `stale bundle ${launch.startup.payload.buildId} expected ${options.buildId}`
      if (staleReason !== undefined) {
        staleRuns += 1
        consecutiveFailures += 1
        if (!isWarmup) {
          rawRuns.push({ run: runNumber, error: staleReason })
        }
        failureRecorded = true
        process.stderr.write(
          `${isWarmup ? 'Warmup' : `Run ${runNumber}`} failed: ${staleReason}\n`,
        )
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          throw new Error(
            `Aborting after ${consecutiveFailures} consecutive startup failures.`,
          )
        }
        continue
      }

      consecutiveFailures = 0
      if (!isWarmup) {
        rawRuns.push(rawRunFromLaunch(runNumber, launch))
      }
      process.stderr.write(
        `${isWarmup ? 'Warmup' : `Run ${runNumber}`} completed.\n`,
      )
    } catch (error) {
      if (!failureRecorded) {
        consecutiveFailures += 1
        const message = String(error)
        if (!isWarmup) {
          rawRuns.push({ run: runNumber, error: message })
        }
        process.stderr.write(
          `${isWarmup ? 'Warmup' : `Run ${runNumber}`} failed: ${message}\n`,
        )
      }
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        throw new Error(
          `Aborting after ${consecutiveFailures} consecutive startup failures.`,
        )
      }
    }
  }

  if (!rawRuns.some(run => run.metrics !== undefined)) {
    throw new Error('No successful startup runs were collected.')
  }

  const metricValues = successfulMetrics(rawRuns)
  const summary = Object.fromEntries(
    Object.entries(metricValues).map(([name, values]) => [
      name,
      summarize(values),
    ]),
  )
  const report: Report = {
    profile: options.profile,
    options: {
      port: options.port,
      runs: options.runs,
      warmup: options.warmup,
      timeoutSeconds: options.timeoutMs / 1000,
    },
    device,
    runs: rawRuns,
    summary,
    staleRuns,
  }
  writeReport(report, options.outPath)
}

run(parseArgs()).catch(error => {
  console.error(String(error))
  process.exitCode = 1
})
