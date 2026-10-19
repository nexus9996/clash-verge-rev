import { describe, expect, it } from 'vitest'

import { areOrdersEqual, resolveMenuOrder } from './use-nav-menu-order'

const ITEMS = [{ path: '/' }, { path: '/proxies' }, { path: '/settings' }]
const BY_PATH = new Map(ITEMS.map((item) => [item.path, item]))
const DEFAULT_ORDER = ITEMS.map((item) => item.path)

describe('nav menu order', () => {
  it('filters unknown and duplicate stored paths', () => {
    expect(
      resolveMenuOrder(
        ['/settings', '/removed-route', '/settings', '/proxies'],
        DEFAULT_ORDER,
        BY_PATH,
      ),
    ).toEqual(['/settings', '/proxies', '/'])
  })

  it('falls back to the default order when storage is empty', () => {
    expect(resolveMenuOrder(null, DEFAULT_ORDER, BY_PATH)).toEqual(
      DEFAULT_ORDER,
    )
    expect(resolveMenuOrder([], DEFAULT_ORDER, BY_PATH)).toEqual(DEFAULT_ORDER)
  })

  it('compares orders structurally', () => {
    expect(areOrdersEqual(['/', '/settings'], ['/', '/settings'])).toBe(true)
    expect(areOrdersEqual(['/', '/settings'], ['/settings', '/'])).toBe(false)
    expect(areOrdersEqual(['/'], ['/', '/proxies'])).toBe(false)
  })
})
