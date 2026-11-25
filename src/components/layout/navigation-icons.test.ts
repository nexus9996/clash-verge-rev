import { describe, expect, it } from 'vitest'

import { NAV_ITEMS } from '@/config/navigation'

import { NAV_ICONS } from './navigation-icons'

describe('navigation icons', () => {
  it('provides an icon pair for every navigation entry', () => {
    expect(Object.keys(NAV_ICONS).sort()).toEqual(
      NAV_ITEMS.map((item) => item.id).sort(),
    )

    for (const icons of Object.values(NAV_ICONS)) {
      expect(icons).toHaveLength(2)
    }
  })
})
