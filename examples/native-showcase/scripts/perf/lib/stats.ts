export type Summary = Readonly<{
  count: number
  min: number
  median: number
  p90: number
  p95: number
  max: number
  mean: number
}>

export const summarize = (values: ReadonlyArray<number>): Summary => {
  if (values.length === 0) {
    return {
      count: 0,
      min: 0,
      median: 0,
      p90: 0,
      p95: 0,
      max: 0,
      mean: 0,
    }
  }

  const sorted = [...values].sort((left, right) => left - right)
  const nearestRank = (quantile: number): number => {
    const rank = Math.max(1, Math.ceil(quantile * sorted.length))
    return sorted.at(rank - 1) ?? 0
  }

  return {
    count: sorted.length,
    min: sorted.at(0) ?? 0,
    median: nearestRank(0.5),
    p90: nearestRank(0.9),
    p95: nearestRank(0.95),
    max: sorted.at(-1) ?? 0,
    mean: values.reduce((total, value) => total + value, 0) / values.length,
  }
}

export const formatMs = (milliseconds: number): string =>
  `${milliseconds.toFixed(2)} ms`
