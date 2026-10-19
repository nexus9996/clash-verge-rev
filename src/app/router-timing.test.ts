import { describe, expect, it } from 'vitest'

import { percentile, summarizeRouteTimings } from './router-timing'

const sample = (durationMs: number, cold: boolean) => ({
  from: '/',
  to: cold ? '/proxies' : '/settings',
  startedAt: 0,
  durationMs,
  cold,
})

describe('route timing', () => {
  it('computes nearest-rank percentiles', () => {
    expect(percentile([], 95)).toBe(0)
    expect(percentile([10], 50)).toBe(10)
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5)
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10)
    expect(percentile([10, 20, 30], 50)).toBe(20)
  })

  it('splits cold and hot navigation samples', () => {
    const report = summarizeRouteTimings([
      sample(120, true),
      sample(40, true),
      sample(20, false),
    ])

    expect(report.total).toBe(3)
    expect(report.cold).toEqual({ count: 2, p50: 40, p95: 120 })
    expect(report.hot).toEqual({ count: 1, p50: 20, p95: 20 })
  })

  it('reports empty buckets when no samples were recorded', () => {
    expect(summarizeRouteTimings([])).toEqual({
      total: 0,
      cold: { count: 0, p50: 0, p95: 0 },
      hot: { count: 0, p50: 0, p95: 0 },
    })
  })
})
