import { describe, expect, it } from 'vitest'

import {
  areOrdersEqual,
  moveOrder,
  resolveMenuOrder,
} from './use-nav-menu-order'

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

  it('moves an entry without mutating the source order', () => {
    const order = ['/', '/proxies', '/profile', '/settings']

    expect(moveOrder(order, 1, 3)).toEqual([
      '/',
      '/profile',
      '/settings',
      '/proxies',
    ])
    expect(moveOrder(order, 3, 0)).toEqual([
      '/settings',
      '/',
      '/proxies',
      '/profile',
    ])
    expect(order).toEqual(['/', '/proxies', '/profile', '/settings'])
  })

  it('ignores no-op and out-of-range moves', () => {
    const order = ['/', '/proxies']

    expect(moveOrder(order, 1, 1)).toBeNull()
    expect(moveOrder(order, -1, 0)).toBeNull()
    expect(moveOrder(order, 0, 2)).toBeNull()
    expect(moveOrder([], 0, 0)).toBeNull()
  })
})
