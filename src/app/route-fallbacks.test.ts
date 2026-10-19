import { describe, expect, it } from 'vitest'

import { formatRouteError } from '@/utils/format-route-error'

describe('formatRouteError', () => {
  it('uses the message of an Error', () => {
    expect(formatRouteError(new Error('boom'))).toBe('boom')
  })

  it('stringifies non-Error values', () => {
    expect(formatRouteError('oops')).toBe('oops')
    expect(formatRouteError(null)).toBe('null')
  })
})
