declare const performance: Readonly<{ now: () => number }>
declare const process: Readonly<{
  env: Readonly<Record<string, string | undefined>>
}>

// NOTE: This file must stay import-free and be the first import of index.ts so this timestamp precedes app module evaluation. The number | undefined value is intentional because importing Effect for Option would defeat the mark.
export const isPerfEnabled: boolean =
  process.env.EXPO_PUBLIC_FOLDKIT_PERF === '1'
export const buildId: string | undefined =
  process.env.EXPO_PUBLIC_FOLDKIT_PERF_BUILD_ID
export const bundleEvaluationStartedAt: number | undefined = isPerfEnabled
  ? performance.now()
  : undefined
