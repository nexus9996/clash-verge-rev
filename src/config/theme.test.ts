import { describe, expect, it } from 'vitest'

import { defaultDarkTheme, defaultTheme } from './theme'

const HEX_COLOR = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i

describe('default theme tokens', () => {
  it('keeps light and dark token keys aligned', () => {
    expect(Object.keys(defaultDarkTheme).sort()).toEqual(
      Object.keys(defaultTheme).sort(),
    )
  })

  it('uses valid hex colors for every color token', () => {
    for (const [key, value] of Object.entries(defaultTheme)) {
      if (key === 'font_family') continue

      expect(value, key).toMatch(HEX_COLOR)
    }
  })
})
