import { describe, expect, it } from 'vitest'

import {
  APP_DATA_QUERY_KEYS,
  DEFAULT_QUERY_OPTIONS,
  MIHOMO_QUERY_OPTIONS,
} from './query-options'

describe('app-data query keys', () => {
  it('keeps the legacy cache keys stable', () => {
    expect(APP_DATA_QUERY_KEYS).toEqual({
      proxyView: ['getProxyView'],
      clashConfig: ['getClashConfig'],
      ruleProviders: ['getRuleProviders'],
      rules: ['getRules'],
      sysproxy: ['getSystemProxy'],
    })
  })

  it('uses unique keys', () => {
    const serialized = Object.values(APP_DATA_QUERY_KEYS).map((key) =>
      JSON.stringify(key),
    )

    expect(new Set(serialized).size).toBe(serialized.length)
  })

  it('keeps the mihomo queries more aggressive than default queries', () => {
    expect(MIHOMO_QUERY_OPTIONS.staleTime).toBeLessThan(
      DEFAULT_QUERY_OPTIONS.staleTime,
    )
    expect(MIHOMO_QUERY_OPTIONS.retry).toBeGreaterThanOrEqual(
      DEFAULT_QUERY_OPTIONS.retry,
    )
  })
})
