import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildBaselineRecord,
  evaluate,
  percentile,
  summarize,
  validateSamples,
} from './nav-timing-lib.mjs'

const sample = (durationMs, cold, to = '/proxies') => ({ to, durationMs, cold })

test('percentile uses nearest-rank on a sorted copy', () => {
  assert.equal(percentile([], 95), 0)
  assert.equal(percentile([10], 50), 10)
  assert.equal(percentile([5, 1, 3, 2, 4], 50), 3)
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95), 10)
})

test('summarize splits cold and hot navigation samples', () => {
  const report = summarize([
    sample(120, true),
    sample(40, true),
    sample(20, false),
    sample(60, false),
  ])

  assert.equal(report.total, 4)
  assert.deepEqual(report.cold, { count: 2, p50: 40, p95: 120 })
  assert.deepEqual(report.hot, { count: 2, p50: 20, p95: 60 })
})

test('validateSamples accepts export envelopes and rejects unusable input', () => {
  const samples = validateSamples({
    samples: [sample(10, true), sample(20, false)],
  })
  assert.equal(samples.length, 2)

  assert.throws(() => validateSamples({ samples: [] }), /no navigation samples/)
  assert.throws(() => validateSamples([sample(-1, true)]), /invalid durationMs/)
  assert.throws(() => validateSamples([sample(10, 'yes')]), /invalid cold flag/)
})

test('evaluate enforces p95 budgets and sample counts', () => {
  const report = summarize([
    ...Array.from({ length: 8 }, () => sample(150, true)),
    ...Array.from({ length: 20 }, () => sample(50, false)),
  ])
  assert.equal(evaluate({ report }).ok, true)

  const tooFew = summarize([sample(10, true), sample(10, false)])
  const result = evaluate({ report: tooFew })
  assert.equal(result.ok, false)
  assert.match(result.failures.join('\n'), /samples/)
})

test('evaluate flags p95 over budget', () => {
  const report = summarize([
    ...Array.from({ length: 8 }, () => sample(250, true)),
    ...Array.from({ length: 20 }, () => sample(150, false)),
  ])
  const result = evaluate({ report })
  assert.equal(result.ok, false)
  assert.match(result.failures.join('\n'), /hot p95 150 ms > 100 ms/)
  assert.match(result.failures.join('\n'), /cold p95 250 ms > 200 ms/)
})

test('buildBaselineRecord keeps thresholds and runs', () => {
  const report = summarize([sample(10, true), sample(20, false)])
  const record = buildBaselineRecord({
    report,
    thresholds: { hotP95: 100, coldP95: 200, minHot: 20, minCold: 8 },
    commit: 'abc123',
    environment: { platform: 'darwin' },
    recordedAt: '2026-10-19T00:00:00.000Z',
  })
  assert.equal(record.schemaVersion, 1)
  assert.equal(record.commit, 'abc123')
  assert.deepEqual(record.runs.cold, report.cold)
})
