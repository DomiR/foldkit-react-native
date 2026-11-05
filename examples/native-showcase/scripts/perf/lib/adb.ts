import { execFileSync } from 'node:child_process'

const MAX_BUFFER_BYTES = 64 * 1024 * 1024

export type ADBOptions = Readonly<{
  cwd?: string
  env?: NodeJS.ProcessEnv
  timeout?: number
}>

export type ViewIntentResult = Readonly<{
  output: string
  totalTime: number | undefined
  waitTime: number | undefined
}>

export const adb = (
  serial: string,
  args: ReadonlyArray<string>,
  options: ADBOptions = {},
): string =>
  execFileSync('adb', ['-s', serial, ...args], {
    cwd: options.cwd,
    encoding: 'utf8',
    env: options.env,
    maxBuffer: MAX_BUFFER_BYTES,
    timeout: options.timeout,
  })

export const forceStop = (serial: string): void => {
  adb(serial, ['shell', 'am', 'force-stop', 'host.exp.exponent'])
}

export const clearLogcat = (serial: string): void => {
  adb(serial, ['logcat', '-c'])
}

export const dumpLogcat = (serial: string): string =>
  adb(serial, [
    'logcat',
    '-d',
    '-v',
    'epoch',
    'ActivityTaskManager:I',
    'ReactNativeJS:V',
    '*:S',
  ])

export const readLoadAverage = (serial: string): number => {
  const firstField = adb(serial, ['shell', 'cat', '/proc/loadavg'])
    .trim()
    .split(/\s+/)
    .at(0)
  const loadAverage =
    firstField === undefined ? Number.NaN : Number.parseFloat(firstField)
  if (!Number.isFinite(loadAverage)) {
    throw new Error(`Could not parse /proc/loadavg on ${serial}.`)
  }
  return loadAverage
}

export const reverse = (serial: string, port: number): void => {
  adb(serial, ['reverse', `tcp:${port}`, `tcp:${port}`])
}

const parseTiming = (output: string, name: string): number | undefined => {
  const match = new RegExp(`^${name}:\\s*(\\d+)`, 'm').exec(output)
  return match?.[1] === undefined ? undefined : Number.parseInt(match[1], 10)
}

export const startViewIntent = (
  serial: string,
  url: string,
): ViewIntentResult => {
  const output = adb(serial, [
    'shell',
    'am',
    'start',
    '-W',
    '-a',
    'android.intent.action.VIEW',
    '-d',
    url,
    'host.exp.exponent',
  ])

  return {
    output,
    totalTime: parseTiming(output, 'TotalTime'),
    waitTime: parseTiming(output, 'WaitTime'),
  }
}
