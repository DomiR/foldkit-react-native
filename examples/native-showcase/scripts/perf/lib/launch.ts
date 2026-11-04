import * as os from 'node:os'
import { setTimeout as sleep } from 'node:timers/promises'

import {
  type ViewIntentResult,
  adb,
  clearLogcat,
  dumpLogcat,
  forceStop,
  readLoadAverage,
  reverse,
  startViewIntent,
} from './adb.ts'
import {
  type BenchErrorPayload,
  type PerfEntry,
  type StartupPayload,
  findIntentStart,
  isPayloadKind,
  parsePerfLines,
} from './perfLog.ts'

const EXP_PACKAGE = 'host.exp.exponent'
const POLL_INTERVAL_MS = 500
const STARTUP_SETTLE_MS = 1500

export type LaunchOptions = Readonly<{
  serial: string
  port: number
  timeoutMs: number
}>

export type DeviceInfo = Readonly<{
  androidRelease: string
  cores: number
  memoryKb: number
  model: string
  hostCpu: string
}>

export type StartupLaunch = Readonly<{
  entries: ReadonlyArray<PerfEntry>
  startup: PerfEntry<StartupPayload>
  loadBefore: number
  intentStartMs: number | undefined
  intent: ViewIntentResult
}>

export type BenchmarkLaunch = Readonly<{
  entries: ReadonlyArray<PerfEntry>
  benchError: BenchErrorPayload | undefined
  loadBefore: number
  intent: ViewIntentResult
}>

const waitForPackager = async (port: number): Promise<void> => {
  const response = await fetch(`http://127.0.0.1:${port}/status`)
  const body = await response.text()
  if (!response.ok || !body.includes('packager-status:running')) {
    throw new Error(
      `Packager status check failed on port ${port}: ${response.status} ${body.trim()}`,
    )
  }
}

export const preflight = async ({
  serial,
  port,
}: LaunchOptions): Promise<void> => {
  let state: string
  try {
    state = adb(serial, ['get-state']).trim()
  } catch (error) {
    throw new Error(`ADB preflight failed for ${serial}: ${String(error)}`)
  }

  if (state !== 'device') {
    throw new Error(
      `ADB device ${serial} is not ready. get-state returned ${state || '<empty>'}.`,
    )
  }

  const packages = adb(serial, ['shell', 'pm', 'list', 'packages', EXP_PACKAGE])
  if (
    !packages
      .split(/\r?\n/)
      .some(line => line.trim() === `package:${EXP_PACKAGE}`)
  ) {
    throw new Error(
      `Expo Go package ${EXP_PACKAGE} is not installed on ${serial}.`,
    )
  }

  try {
    await waitForPackager(port)
  } catch (error) {
    throw new Error(`Packager preflight failed: ${String(error)}`)
  }

  reverse(serial, port)
}

const parseMemoryKb = (meminfo: string): number => {
  const match = /^MemTotal:\s+(\d+)\s+kB/m.exec(meminfo)
  return match?.[1] === undefined ? 0 : Number.parseInt(match[1], 10)
}

export const readDeviceInfo = (serial: string): DeviceInfo => {
  const androidRelease = adb(serial, [
    'shell',
    'getprop',
    'ro.build.version.release',
  ]).trim()
  const coresText = adb(serial, ['shell', 'nproc']).trim()
  const meminfo = adb(serial, ['shell', 'cat', '/proc/meminfo'])
  const model = adb(serial, ['shell', 'getprop', 'ro.product.model']).trim()
  const hostCpu = os.cpus().at(0)?.model ?? 'unknown'

  return {
    androidRelease,
    cores: Number.parseInt(coresText, 10),
    memoryKb: parseMemoryKb(meminfo),
    model,
    hostCpu,
  }
}

const waitForEntries = async (
  serial: string,
  timeoutMs: number,
  condition: (entries: ReadonlyArray<PerfEntry>) => boolean,
): Promise<Readonly<{ lines: string; entries: Array<PerfEntry> }>> => {
  const deadline = Date.now() + timeoutMs
  let lines = ''

  while (Date.now() <= deadline) {
    lines = dumpLogcat(serial)
    const entries = parsePerfLines(lines)
    if (condition(entries)) {
      return { lines, entries }
    }

    await sleep(POLL_INTERVAL_MS)
  }

  throw new Error(
    `Timed out after ${timeoutMs} ms waiting for Foldkit performance logs.`,
  )
}

export const launchStartup = async ({
  serial,
  port,
  timeoutMs,
}: LaunchOptions): Promise<StartupLaunch> => {
  forceStop(serial)
  await sleep(STARTUP_SETTLE_MS)
  clearLogcat(serial)

  try {
    const loadBefore = readLoadAverage(serial)
    const intent = startViewIntent(serial, `exp://127.0.0.1:${port}`)
    const result = await waitForEntries(serial, timeoutMs, entries =>
      entries.some(entry => isPayloadKind(entry, 'startup')),
    )
    const startup = result.entries.find(entry =>
      isPayloadKind(entry, 'startup'),
    )
    if (startup === undefined) {
      throw new Error(
        'Startup log polling completed without a startup payload.',
      )
    }

    return {
      entries: result.entries,
      startup,
      loadBefore,
      intentStartMs: findIntentStart(result.lines),
      intent,
    }
  } finally {
    forceStop(serial)
  }
}

export const launchBenchmark = async ({
  serial,
  port,
  timeoutMs,
}: LaunchOptions): Promise<BenchmarkLaunch> => {
  forceStop(serial)
  await sleep(STARTUP_SETTLE_MS)
  clearLogcat(serial)

  try {
    const loadBefore = readLoadAverage(serial)
    const intent = startViewIntent(serial, `exp://127.0.0.1:${port}`)
    const result = await waitForEntries(
      serial,
      timeoutMs,
      entries =>
        entries.some(entry => isPayloadKind(entry, 'benchDone')) ||
        entries.some(entry => isPayloadKind(entry, 'benchError')),
    )
    const benchError = result.entries.find(entry =>
      isPayloadKind(entry, 'benchError'),
    )
    return {
      entries: result.entries,
      benchError: benchError?.payload,
      loadBefore,
      intent,
    }
  } finally {
    forceStop(serial)
  }
}
