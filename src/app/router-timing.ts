import type { AnyRouter } from '@tanstack/react-router'

/**
 * Opt-in route navigation timing for the manual protocol in
 * docs/perf/navigation-timing.md. Enabled in dev builds by setting
 * localStorage['verge.routeTiming'] = '1' and reloading.
 */
interface RouteTimingSample {
  from: string
  to: string
  startedAt: number
  durationMs: number
  cold: boolean
}

interface RouteTimingBucket {
  count: number
  p50: number
  p95: number
}

interface RouteTimingReport {
  total: number
  cold: RouteTimingBucket
  hot: RouteTimingBucket
}

interface RouteTimingExport {
  samples: RouteTimingSample[]
  report: RouteTimingReport
  userAgent: string
  location: string
}

const STORAGE_KEY = 'verge.routeTiming'
const MAX_SAMPLES = 500

const samples: RouteTimingSample[] = []
const visited = new Set<string>()
let active = false

const round = (value: number) => Math.round(value * 10) / 10

/** Nearest-rank percentile over a sorted copy; `p` is 0..100. */
export const percentile = (values: readonly number[], p: number): number => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const rank = Math.ceil((p / 100) * sorted.length)
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1))
  return round(sorted[index])
}

const bucket = (values: readonly number[]): RouteTimingBucket => ({
  count: values.length,
  p50: percentile(values, 50),
  p95: percentile(values, 95),
})

export const summarizeRouteTimings = (
  input: readonly RouteTimingSample[] = samples,
): RouteTimingReport => ({
  total: input.length,
  cold: bucket(
    input.filter((sample) => sample.cold).map(({ durationMs }) => durationMs),
  ),
  hot: bucket(
    input.filter((sample) => !sample.cold).map(({ durationMs }) => durationMs),
  ),
})

export const getRouteTimingSamples = () => samples.slice()

const exportRouteTimings = (): RouteTimingExport => ({
  samples: samples.slice(),
  report: summarizeRouteTimings(samples),
  userAgent: typeof navigator === 'undefined' ? 'unknown' : navigator.userAgent,
  location: typeof window === 'undefined' ? 'unknown' : window.location.href,
})

export const clearRouteTimings = () => {
  samples.length = 0
  visited.clear()
}

const record = (sample: RouteTimingSample) => {
  if (!active) return
  visited.add(sample.to)
  samples.push(sample)
  if (samples.length > MAX_SAMPLES) samples.shift()
}

/** Optional fallback for reload-based workflows; no longer required. */
const autoStartRequested = () => {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export const installRouteTiming = (router: AnyRouter) => {
  active = false
  const pending = new Map<string, { from: string; startedAt: number }>()

  const start = () => {
    samples.length = 0
    visited.clear()
    pending.clear()
    active = true
    console.info('[nav-timing] recording started')
  }

  const stop = () => {
    active = false
    pending.clear()
    console.info(
      '[nav-timing] recording stopped; inspect with __vergeNavTiming.getReport()',
    )
  }

  router.subscribe('onBeforeNavigate', (event) => {
    if (!event.pathChanged) return
    pending.set(event.toLocation.href, {
      from: event.fromLocation?.pathname ?? '',
      startedAt: performance.now(),
    })
  })

  router.subscribe('onRendered', (event) => {
    const entry = pending.get(event.toLocation.href)
    if (!entry) return
    pending.delete(event.toLocation.href)

    const to = event.toLocation.pathname
    const cold = !visited.has(to)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        record({
          from: entry.from,
          to,
          startedAt: entry.startedAt,
          durationMs: performance.now() - entry.startedAt,
          cold,
        })
      })
    })
  })

  window.__vergeNavTiming = {
    start,
    stop,
    getSamples: getRouteTimingSamples,
    getReport: () => summarizeRouteTimings(),
    export: exportRouteTimings,
    clear: clearRouteTimings,
  }

  if (autoStartRequested()) start()
  else
    console.info(
      '[nav-timing] ready; call __vergeNavTiming.start() before navigating (no reload needed)',
    )
}

declare global {
  interface Window {
    __vergeNavTiming?: {
      start: () => void
      stop: () => void
      getSamples: typeof getRouteTimingSamples
      getReport: () => RouteTimingReport
      export: typeof exportRouteTimings
      clear: typeof clearRouteTimings
    }
  }
}
