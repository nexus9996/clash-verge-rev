import { describe, expect, it } from 'vitest'

import { defaultDarkTheme, defaultTheme } from './defaults'
import { THEME_PRESETS } from './presets'

const PRESET_COLOR_KEYS = [
  'primary_color',
  'secondary_color',
  'primary_text',
  'secondary_text',
  'info_color',
  'error_color',
  'warning_color',
  'success_color',
] as const

describe('theme presets', () => {
  it('ships the six presets with unique ids', () => {
    expect(THEME_PRESETS).toHaveLength(6)
    expect(new Set(THEME_PRESETS.map((preset) => preset.id)).size).toBe(6)
  })

  it('defines the same color keys for light and dark', () => {
    for (const preset of THEME_PRESETS) {
      expect(Object.keys(preset.light).sort(), preset.id).toEqual(
        [...PRESET_COLOR_KEYS].sort(),
      )
      expect(Object.keys(preset.dark).sort(), preset.id).toEqual(
        [...PRESET_COLOR_KEYS].sort(),
      )
    }
  })

  it('keeps the default preset aligned with the default themes', () => {
    const preset = THEME_PRESETS.find((entry) => entry.id === 'default')
    expect(preset).toBeTruthy()

    expect(preset?.light.primary_color).toBe(defaultTheme.primary_color)
    expect(preset?.light.secondary_color).toBe(defaultTheme.secondary_color)
    expect(preset?.dark.primary_color).toBe(defaultDarkTheme.primary_color)
    expect(preset?.dark.secondary_color).toBe(defaultDarkTheme.secondary_color)
  })
})
