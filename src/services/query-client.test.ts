import { describe, expect, it } from 'vitest'

import { resolveErrorRetryCount } from './query-client'

describe('resolveErrorRetryCount', () => {
  it('falls back to the shared retry budget when retry is omitted', () => {
    expect(resolveErrorRetryCount(undefined, 3)).toBe(3)
  })

  it('disables retries when retry is false', () => {
    expect(resolveErrorRetryCount(false, 3)).toBe(0)
  })

  it('preserves an explicit retry count, including zero', () => {
    expect(resolveErrorRetryCount(5, 3)).toBe(5)
    expect(resolveErrorRetryCount(0, 3)).toBe(0)
  })
})
