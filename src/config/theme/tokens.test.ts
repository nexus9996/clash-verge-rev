import { describe, expect, it } from 'vitest'

import { defaultDarkTheme, defaultTheme } from './defaults'
import {
  createThemeCssVariables,
  RADIUS,
  resolveModeSurfaces,
  resolveThemeColors,
  SHADOW,
  SPACE,
  Z_INDEX,
} from './tokens'

describe('theme tokens', () => {
  it('keeps the legacy css variables used by the stylesheets', () => {
    const variables = createThemeCssVariables({
      mode: 'light',
      setting: undefined,
      colors: resolveThemeColors(undefined, defaultTheme),
    })

    for (const name of [
      '--divider-color',
      '--background-color',
      '--selection-color',
      '--scroller-color',
      '--primary-main',
      '--background-color-alpha',
      '--window-border-color',
      '--scrollbar-bg',
      '--scrollbar-thumb',
    ]) {
      expect(variables[name], name).toBeTruthy()
    }
  })

  it('generates the semantic scale variables', () => {
    const variables = createThemeCssVariables({
      mode: 'light',
      setting: undefined,
      colors: resolveThemeColors(undefined, defaultTheme),
    })

    expect(variables['--space-md']).toBe(`${SPACE.md}px`)
    expect(variables['--radius-pill']).toBe(`${RADIUS.pill}px`)
    expect(variables['--shadow-sm']).toBe(SHADOW.sm)
    expect(variables['--z-modal']).toBe(String(Z_INDEX.modal))
    expect(variables['--overlay-soft']).toBe('0.08')
    expect(variables['--color-primary']).toBe(defaultTheme.primary_color)
    expect(variables['--color-text-primary']).toBe(defaultTheme.primary_text)
    expect(variables['--color-divider']).toBe(
      resolveModeSurfaces('light').divider,
    )
    expect(variables['--surface-card']).toBe(
      resolveModeSurfaces('light').cardBackground,
    )
    expect(variables['--surface-page']).toBe(
      resolveModeSurfaces('light').pageBackground,
    )
  })

  it('prefers user color settings over defaults', () => {
    const colors = resolveThemeColors(
      {
        primary_color: '#112233',
        background_color: '#EFEFEF',
        paper_background_color: '#FAFAFA',
        font_family: 'Custom Sans',
      },
      defaultTheme,
    )

    expect(colors.primary).toBe('#112233')
    expect(colors.background).toBe('#EFEFEF')
    expect(colors.paper).toBe('#FAFAFA')
    expect(colors.fontFamily).toContain('Custom Sans')
    expect(colors.fontFamily).toContain(defaultTheme.font_family)
  })

  it('falls back to the default surface colors', () => {
    const colors = resolveThemeColors(undefined, defaultDarkTheme)

    expect(colors.primary).toBe(defaultDarkTheme.primary_color)
    expect(colors.paper).toBe(defaultDarkTheme.background_color)

    const surfaces = resolveModeSurfaces('dark')
    const variables = createThemeCssVariables({
      mode: 'dark',
      setting: undefined,
      colors,
    })
    expect(variables['--background-color']).toBe(surfaces.fallbackBackground)
    expect(variables['--dialog-background']).toBe(surfaces.dialogBackground)
  })

  it('uses mode-dependent surface values', () => {
    expect(resolveModeSurfaces('light')).not.toEqual(
      resolveModeSurfaces('dark'),
    )
  })
})
