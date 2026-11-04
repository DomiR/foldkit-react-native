export type StartupPayload = Readonly<{
  kind: 'startup'
  buildId: string
  rnStartTime: number | null
  rnInitRuntimeStart: number | null
  rnEntryPointStart: number | null
  bundleEvalStart: number
  modulesEvaluated: number
  programCreated: number
  firstViewStart: number
  firstViewEnd: number
  firstCommit: number
}>

export type LatencyPayload = Readonly<{
  kind: 'latency'
  buildId: string
  i: number
  queue: number
  update: number
  frameWait: number
  view: number
  commit: number
  total: number
}>

export type BurstPayload = Readonly<{
  kind: 'burst'
  buildId: string
  n: number
  rep: number
  totalMs: number
  dispatchLoopMs: number
  updates: number
  views: number
  commits: number
  updateMs: number
  viewMs: number
  maxViewMs: number
  countDelta: number
}>

export type BenchDonePayload = Readonly<{
  kind: 'benchDone'
  buildId: string
}>

export type BenchErrorPayload = Readonly<{
  kind: 'benchError'
  buildId: string
  message: string
}>

export type PerfPayload =
  | StartupPayload
  | LatencyPayload
  | BurstPayload
  | BenchDonePayload
  | BenchErrorPayload

export type PerfEntry<Payload extends PerfPayload = PerfPayload> = Readonly<{
  epochMs: number
  payload: Payload
}>

type PayloadOfKind<Kind extends PerfPayload['kind']> = Extract<
  PerfPayload,
  { kind: Kind }
>

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const readRequiredNumber = (
  payload: Readonly<Record<string, unknown>>,
  name: string,
): number | undefined => {
  const value = payload[name]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

const readNullableNumber = (
  payload: Readonly<Record<string, unknown>>,
  name: string,
): number | null | undefined => {
  const value = payload[name]
  if (value === null) {
    return null
  }
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

const readRequiredString = (
  payload: Readonly<Record<string, unknown>>,
  name: string,
): string | undefined => {
  const value = payload[name]
  return typeof value === 'string' ? value : undefined
}

const parsePayload = (value: unknown): PerfPayload | undefined => {
  if (!isRecord(value)) {
    return undefined
  }

  const kind = value['kind']
  if (kind === 'startup') {
    const buildId = readRequiredString(value, 'buildId')
    const rnStartTime = readNullableNumber(value, 'rnStartTime')
    const rnInitRuntimeStart = readNullableNumber(value, 'rnInitRuntimeStart')
    const rnEntryPointStart = readNullableNumber(value, 'rnEntryPointStart')
    const bundleEvalStart = readRequiredNumber(value, 'bundleEvalStart')
    const modulesEvaluated = readRequiredNumber(value, 'modulesEvaluated')
    const programCreated = readRequiredNumber(value, 'programCreated')
    const firstViewStart = readRequiredNumber(value, 'firstViewStart')
    const firstViewEnd = readRequiredNumber(value, 'firstViewEnd')
    const firstCommit = readRequiredNumber(value, 'firstCommit')
    if (
      buildId === undefined ||
      rnStartTime === undefined ||
      rnInitRuntimeStart === undefined ||
      rnEntryPointStart === undefined ||
      bundleEvalStart === undefined ||
      modulesEvaluated === undefined ||
      programCreated === undefined ||
      firstViewStart === undefined ||
      firstViewEnd === undefined ||
      firstCommit === undefined
    ) {
      return undefined
    }
    return {
      kind,
      buildId,
      rnStartTime,
      rnInitRuntimeStart,
      rnEntryPointStart,
      bundleEvalStart,
      modulesEvaluated,
      programCreated,
      firstViewStart,
      firstViewEnd,
      firstCommit,
    }
  }

  if (kind === 'latency') {
    const buildId = readRequiredString(value, 'buildId')
    const i = readRequiredNumber(value, 'i')
    const queue = readRequiredNumber(value, 'queue')
    const update = readRequiredNumber(value, 'update')
    const frameWait = readRequiredNumber(value, 'frameWait')
    const view = readRequiredNumber(value, 'view')
    const commit = readRequiredNumber(value, 'commit')
    const total = readRequiredNumber(value, 'total')
    if (
      buildId === undefined ||
      i === undefined ||
      queue === undefined ||
      update === undefined ||
      frameWait === undefined ||
      view === undefined ||
      commit === undefined ||
      total === undefined
    ) {
      return undefined
    }
    return { kind, buildId, i, queue, update, frameWait, view, commit, total }
  }

  if (kind === 'burst') {
    const buildId = readRequiredString(value, 'buildId')
    const n = readRequiredNumber(value, 'n')
    const rep = readRequiredNumber(value, 'rep')
    const totalMs = readRequiredNumber(value, 'totalMs')
    const dispatchLoopMs = readRequiredNumber(value, 'dispatchLoopMs')
    const updates = readRequiredNumber(value, 'updates')
    const views = readRequiredNumber(value, 'views')
    const commits = readRequiredNumber(value, 'commits')
    const updateMs = readRequiredNumber(value, 'updateMs')
    const viewMs = readRequiredNumber(value, 'viewMs')
    const maxViewMs = readRequiredNumber(value, 'maxViewMs')
    const countDelta = readRequiredNumber(value, 'countDelta')
    if (
      buildId === undefined ||
      n === undefined ||
      rep === undefined ||
      totalMs === undefined ||
      dispatchLoopMs === undefined ||
      updates === undefined ||
      views === undefined ||
      commits === undefined ||
      updateMs === undefined ||
      viewMs === undefined ||
      maxViewMs === undefined ||
      countDelta === undefined
    ) {
      return undefined
    }
    return {
      kind,
      buildId,
      n,
      rep,
      totalMs,
      dispatchLoopMs,
      updates,
      views,
      commits,
      updateMs,
      viewMs,
      maxViewMs,
      countDelta,
    }
  }

  if (kind === 'benchDone') {
    const buildId = readRequiredString(value, 'buildId')
    return buildId === undefined ? undefined : { kind, buildId }
  }

  if (kind === 'benchError') {
    const buildId = readRequiredString(value, 'buildId')
    const message = readRequiredString(value, 'message')
    return buildId === undefined || message === undefined
      ? undefined
      : { kind, buildId, message }
  }

  return undefined
}

export const isPayloadKind = <Kind extends PerfPayload['kind']>(
  entry: PerfEntry,
  kind: Kind,
): entry is PerfEntry<PayloadOfKind<Kind>> => entry.payload.kind === kind

const epochMsFromLine = (line: string): number | undefined => {
  const match = /^\s*(\d+(?:\.\d+)?)/.exec(line)
  if (match?.[1] === undefined) {
    return undefined
  }

  return Number.parseFloat(match[1]) * 1000
}

export const parsePerfLines = (lines: string): Array<PerfEntry> => {
  const entries: Array<PerfEntry> = []

  for (const line of lines.split(/\r?\n/)) {
    const epochMs = epochMsFromLine(line)
    const match =
      /^\s*\d+(?:\.\d+)?\s+\d+\s+\d+\s+[A-Z]\s+[^:]+:\s+FOLDKIT_PERF\s+(.+?)\s*$/.exec(
        line,
      )
    if (epochMs === undefined || match?.[1] === undefined) {
      continue
    }

    try {
      const payload = parsePayload(JSON.parse(match[1]))
      if (payload !== undefined) {
        entries.push({ epochMs, payload })
      }
    } catch {
      continue
    }
  }

  return entries
}

export const findIntentStart = (lines: string): number | undefined => {
  for (const line of lines.split(/\r?\n/)) {
    if (
      line.includes('ActivityTaskManager') &&
      line.includes('START') &&
      line.includes('exp://')
    ) {
      const epochMs = epochMsFromLine(line)
      if (epochMs !== undefined) {
        return epochMs
      }
    }
  }

  return undefined
}
