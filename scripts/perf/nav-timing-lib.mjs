export const HOT_P95_MS = 100
export const COLD_P95_MS = 200
export const MIN_HOT_SAMPLES = 20
export const MIN_COLD_SAMPLES = 8

const round = (value) => Math.round(value * 10) / 10

/** Nearest-rank percentile over a sorted copy; `p` is 0..100. Empty input yields 0. */
export const percentile = (values, p) => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const rank = Math.ceil((p / 100) * sorted.length)
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1))
  return round(sorted[index])
}

const bucket = (values) => ({
  count: values.length,
  p50: percentile(values, 50),
  p95: percentile(values, 95),
})

export const summarize = (samples) => ({
  total: samples.length,
  cold: bucket(
    samples.filter(({ cold }) => cold).map(({ durationMs }) => durationMs),
  ),
  hot: bucket(
    samples.filter(({ cold }) => !cold).map(({ durationMs }) => durationMs),
  ),
})

/**
 * Accepts either the `__vergeNavTiming.export()` envelope (`{ samples }`) or a
 * bare sample array. Throws when the payload cannot be measured.
 */
export const validateSamples = (payload) => {
  const samples = Array.isArray(payload) ? payload : payload?.samples
  if (!Array.isArray(samples) || samples.length === 0) {
    throw new Error(
      'no navigation samples found; expected the JSON copied from __vergeNavTiming.export()',
    )
  }

  return samples.map((sample, index) => {
    if (!sample || typeof sample !== 'object') {
      throw new Error(`sample ${index} is not an object`)
    }
    const { durationMs, cold, to } = sample
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      throw new Error(
        `sample ${index} has an invalid durationMs: ${durationMs}`,
      )
    }
    if (typeof cold !== 'boolean') {
      throw new Error(`sample ${index} has an invalid cold flag: ${cold}`)
    }
    return {
      to: typeof to === 'string' ? to : 'unknown',
      durationMs,
      cold,
    }
  })
}

export const evaluate = ({
  report,
  hotP95 = HOT_P95_MS,
  coldP95 = COLD_P95_MS,
  minHot = MIN_HOT_SAMPLES,
  minCold = MIN_COLD_SAMPLES,
}) => {
  const failures = []
  if (report.hot.count < minHot) {
    failures.push(`hot navigation samples ${report.hot.count} < ${minHot}`)
  }
  if (report.cold.count < minCold) {
    failures.push(`cold navigation samples ${report.cold.count} < ${minCold}`)
  }
  if (report.hot.p95 > hotP95) {
    failures.push(`hot p95 ${report.hot.p95} ms > ${hotP95} ms`)
  }
  if (report.cold.p95 > coldP95) {
    failures.push(`cold p95 ${report.cold.p95} ms > ${coldP95} ms`)
  }

  return {
    ok: failures.length === 0,
    failures,
    thresholds: { hotP95, coldP95, minHot, minCold },
  }
}

export const formatReport = (report) => {
  const line = (label, bucket) =>
    `${label.padEnd(5)} n=${String(bucket.count).padStart(3)}  p50=${String(
      bucket.p50,
    ).padStart(6)} ms  p95=${String(bucket.p95).padStart(6)} ms`
  return [
    `navigation samples: ${report.total}`,
    line('cold', report.cold),
    line('hot', report.hot),
  ].join('\n')
}

export const buildBaselineRecord = ({
  report,
  thresholds,
  commit,
  environment,
  label = 'navigation-timing',
  recordedAt = new Date().toISOString(),
}) => ({
  schemaVersion: 1,
  label,
  recordedAt,
  commit,
  environment,
  thresholds,
  runs: { cold: report.cold, hot: report.hot },
})
