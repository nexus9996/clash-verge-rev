import { expect, test } from 'vitest'

import type { RuleExtraInfo } from '@/services/cmds'

import { mergeRuleExtras } from './rule-extras'

const extra = (
  index: number,
  overrides: Partial<RuleExtraInfo> = {},
): RuleExtraInfo => ({
  index,
  disabled: false,
  hitCount: 0,
  hitAt: '',
  missCount: 0,
  missAt: '',
  ...overrides,
})

test('keeps the previous map when the snapshot is unchanged', () => {
  const first = new Map([
    [0, extra(0)],
    [1, extra(1, { hitCount: 3 })],
  ])

  const merged = mergeRuleExtras(first, [extra(0), extra(1, { hitCount: 3 })])

  expect(merged).toBe(first)
})

test('keeps unchanged rows by identity and swaps only the changed ones', () => {
  const unchanged = extra(0)
  const previous = new Map([
    [0, unchanged],
    [1, extra(1, { hitCount: 1 })],
  ])

  const merged = mergeRuleExtras(previous, [
    extra(0),
    extra(1, { hitCount: 2 }),
  ])

  expect(merged).not.toBe(previous)
  expect(merged.get(0)).toBe(unchanged)
  expect(merged.get(1)?.hitCount).toBe(2)
})

test('drops rows that are no longer reported', () => {
  const previous = new Map([
    [0, extra(0)],
    [1, extra(1)],
  ])

  const merged = mergeRuleExtras(previous, [extra(0)])

  expect([...merged.keys()]).toEqual([0])
})
