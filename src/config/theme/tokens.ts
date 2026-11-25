import { alpha } from '@mui/material'

/**
 * Semantic design tokens. Raw color literals for mode-dependent surfaces live
 * here (and only here); components consume the generated CSS variables or the
 * scale constants instead of hardcoding values.
 */
export const SPACE = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const

export const RADIUS = {
  xs: 4,
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  pill: 999,
} as const

export const Z_INDEX = {
  base: 0,
  sticky: 100,
  header: 1000,
  modal: 1300,
  toast: 1500,
  tooltip: 1600,
} as const

export const SHADOW = {
  none: 'none',
  sm: '0 1px 2px rgba(0, 0, 0, 0.08)',
  md: '0 4px 12px rgba(0, 0, 0, 0.12)',
  lg: '0 12px 32px rgba(0, 0, 0, 0.18)',
} as const

const OVERLAY = {
  subtle: 0.04,
  soft: 0.08,
  medium: 0.12,
  strong: 0.24,
} as const

type ThemeColorKey =
  | 'primary_color'
  | 'secondary_color'
  | 'primary_text'
  | 'secondary_text'
  | 'info_color'
  | 'error_color'
  | 'warning_color'
  | 'success_color'
  | 'background_color'
  | 'paper_background_color'

type ThemeColorSetting = Partial<
  Record<ThemeColorKey, string | null | undefined>
> & {
  font_family?: string | null
}

interface ThemeColorDefaults {
  primary_color: string
  secondary_color: string
  primary_text: string
  secondary_text: string
  info_color: string
  error_color: string
  warning_color: string
  success_color: string
  background_color: string
  font_family: string
}

export interface ResolvedThemeColors {
  primary: string
  secondary: string
  info: string
  error: string
  warning: string
  success: string
  textPrimary: string
  textSecondary: string
  background: string
  paper: string
  fontFamily: string
}

export const resolveThemeColors = (
  setting: ThemeColorSetting | undefined,
  defaults: ThemeColorDefaults,
): ResolvedThemeColors => {
  const pick = (key: ThemeColorKey, fallback: string) =>
    setting?.[key] || fallback

  return {
    primary: pick('primary_color', defaults.primary_color),
    secondary: pick('secondary_color', defaults.secondary_color),
    info: pick('info_color', defaults.info_color),
    error: pick('error_color', defaults.error_color),
    warning: pick('warning_color', defaults.warning_color),
    success: pick('success_color', defaults.success_color),
    textPrimary: pick('primary_text', defaults.primary_text),
    textSecondary: pick('secondary_text', defaults.secondary_text),
    background: pick('background_color', defaults.background_color),
    paper: pick('paper_background_color', defaults.background_color),
    fontFamily: setting?.font_family
      ? `${setting.font_family}, ${defaults.font_family}`
      : defaults.font_family,
  }
}

interface ModeSurfaces {
  fallbackBackground: string
  cardBackground: string
  pageBackground: string
  loadingBackground: string
  loadingText: string
  logHighlight: string
  switchTrackOff: string
  selection: string
  scroller: string
  divider: string
  windowBorder: string
  scrollbarBg: string
  scrollbarThumb: string
  scrollbarThumbHover: string
  dialogBackground: string
}

const LIGHT_SURFACES: ModeSurfaces = {
  fallbackBackground: '#ECECEC',
  cardBackground: '#ffffff',
  pageBackground: '#ffffff',
  loadingBackground: '#fff',
  loadingText: '#333',
  logHighlight: '#ffeb3b90',
  switchTrackOff: '#BBBBBB',
  selection: '#f5f5f5',
  scroller: '#90939980',
  divider: 'rgba(0, 0, 0, 0.06)',
  windowBorder: '#cccccc',
  scrollbarBg: '#f1f1f1',
  scrollbarThumb: '#c1c1c1',
  scrollbarThumbHover: '#a1a1a1',
  dialogBackground: '#ffffff',
}

const DARK_SURFACES: ModeSurfaces = {
  fallbackBackground: '#2E303D',
  cardBackground: '#282a36',
  pageBackground: '#1e1f27',
  loadingBackground: '#181a1b',
  loadingText: '#fff',
  logHighlight: '#ffeb3b40',
  switchTrackOff: '#39393D',
  selection: '#3E3E3E',
  scroller: '#555555',
  divider: 'rgba(255, 255, 255, 0.06)',
  windowBorder: '#1E1E1E',
  scrollbarBg: '#2E303D',
  scrollbarThumb: '#555555',
  scrollbarThumbHover: '#666666',
  dialogBackground: '#2E303D',
}

const SWITCH_ACTIVE = '#33cf4d'
const SWITCH_THUMB = '#ffffff'

export const resolveModeSurfaces = (mode: 'light' | 'dark'): ModeSurfaces =>
  mode === 'light' ? LIGHT_SURFACES : DARK_SURFACES

interface CssVariablesOptions {
  mode: 'light' | 'dark'
  setting: ThemeColorSetting | undefined
  colors: ResolvedThemeColors
}

/**
 * Legacy variables keep their names/values for the existing SCSS consumers;
 * semantic color and scale variables are additive.
 */
export const createThemeCssVariables = ({
  mode,
  setting,
  colors,
}: CssVariablesOptions): Record<string, string> => {
  const surfaces = resolveModeSurfaces(mode)
  const background = setting?.background_color || surfaces.fallbackBackground
  const variables: Record<string, string> = {
    '--divider-color': surfaces.divider,
    '--background-color': background,
    '--selection-color': surfaces.selection,
    '--scroller-color': surfaces.scroller,
    '--primary-main': colors.primary,
    '--background-color-alpha': alpha(colors.primary, 0.1),
    '--window-border-color': surfaces.windowBorder,
    '--scrollbar-bg': surfaces.scrollbarBg,
    '--scrollbar-thumb': surfaces.scrollbarThumb,
    '--scrollbar-thumb-hover': surfaces.scrollbarThumbHover,
    '--dialog-background':
      setting?.paper_background_color || surfaces.dialogBackground,
    '--color-primary': colors.primary,
    '--color-secondary': colors.secondary,
    '--color-info': colors.info,
    '--color-error': colors.error,
    '--color-warning': colors.warning,
    '--color-success': colors.success,
    '--color-text-primary': colors.textPrimary,
    '--color-text-secondary': colors.textSecondary,
    '--color-background': background,
    '--color-paper': colors.paper,
    '--color-divider': surfaces.divider,
    '--color-border': surfaces.windowBorder,
    '--surface-card': surfaces.cardBackground,
    '--surface-page': surfaces.pageBackground,
    '--log-highlight': surfaces.logHighlight,
    '--switch-active': SWITCH_ACTIVE,
    '--switch-thumb': SWITCH_THUMB,
    '--switch-track-off': surfaces.switchTrackOff,
  }

  for (const [key, value] of Object.entries(SPACE)) {
    variables[`--space-${key}`] = `${value}px`
  }
  for (const [key, value] of Object.entries(RADIUS)) {
    variables[`--radius-${key}`] = `${value}px`
  }
  for (const [key, value] of Object.entries(SHADOW)) {
    variables[`--shadow-${key}`] = value
  }
  for (const [key, value] of Object.entries(Z_INDEX)) {
    variables[`--z-${key}`] = String(value)
  }
  for (const [key, value] of Object.entries(OVERLAY)) {
    variables[`--overlay-${key}`] = String(value)
  }

  return variables
}
