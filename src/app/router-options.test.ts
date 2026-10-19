import { describe, expect, it } from 'vitest'

import { ROUTER_DEFAULTS } from './router-options'

describe('router defaults', () => {
  it('keeps the no-flash navigation policy', () => {
    expect(ROUTER_DEFAULTS.defaultPreload).toBe('intent')
    expect(ROUTER_DEFAULTS.defaultPreloadDelay).toBe(0)
    expect(ROUTER_DEFAULTS.defaultPendingMs).toBeGreaterThan(0)
    expect(ROUTER_DEFAULTS.defaultPendingMinMs).toBeGreaterThanOrEqual(
      ROUTER_DEFAULTS.defaultPendingMs,
    )
  })
})
