import assert from 'node:assert/strict'
import test from 'node:test'

import { evaluateBudget } from '../check-bundle-budget.mjs'

const bundle = (gzipBytes) => ({ initial: { js: { gzipBytes } } })

test('passes when the initial payload stays within tolerance', () => {
  const result = evaluateBudget({
    current: bundle(1020),
    baseline: bundle(1000),
    tolerance: 1.02,
  })

  assert.equal(result.withinBudget, true)
  assert.equal(result.budgetBytes, 1020)
  assert.equal(result.deltaBytes, 20)
})

test('fails when the initial payload exceeds tolerance', () => {
  const result = evaluateBudget({
    current: bundle(1021),
    baseline: bundle(1000),
    tolerance: 1.02,
  })

  assert.equal(result.withinBudget, false)
  assert.equal(result.deltaBytes, 21)
})

test('treats a shrunken payload as passing', () => {
  const result = evaluateBudget({
    current: bundle(900),
    baseline: bundle(1000),
    tolerance: 1.02,
  })

  assert.equal(result.withinBudget, true)
  assert.ok(result.deltaRatio < 0)
})

test('rejects malformed baselines', () => {
  assert.throws(
    () => evaluateBudget({ current: bundle(1), baseline: {}, tolerance: 1.02 }),
    /missing initial\.js\.gzipBytes/,
  )
})
