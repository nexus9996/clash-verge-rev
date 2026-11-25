import { describe, expect, it, vi } from 'vitest'

import { NAV_ITEMS, resolveNavigationPath } from './navigation'

describe('navigation catalog', () => {
  it('keeps navigation ids and paths unique', () => {
    expect(new Set(NAV_ITEMS.map((item) => item.id)).size).toBe(
      NAV_ITEMS.length,
    )
    expect(new Set(NAV_ITEMS.map((item) => item.path)).size).toBe(
      NAV_ITEMS.length,
    )
  })

  it('resolves known backend paths without warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(resolveNavigationPath('/settings')).toBe('/settings')
    expect(resolveNavigationPath('/profile')).toBe('/profile')
    expect(warn).not.toHaveBeenCalled()

    warn.mockRestore()
  })

  it('falls back to home for unknown paths', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(resolveNavigationPath('/not-a-route')).toBe('/')
    expect(warn).toHaveBeenCalledOnce()

    warn.mockRestore()
  })
})
