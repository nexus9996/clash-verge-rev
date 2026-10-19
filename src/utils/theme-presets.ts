import { defaultDarkTheme, defaultTheme } from '@/pages/_theme'

export type ThemeColorKey =
  | 'primary_color'
  | 'secondary_color'
  | 'primary_text'
  | 'secondary_text'
  | 'info_color'
  | 'error_color'
  | 'warning_color'
  | 'success_color'

export type ThemePresetId =
  | 'default'
  | 'ocean'
  | 'indigo'
  | 'sunset'
  | 'lavender'
  | 'monochrome'

type ThemePresetColors = Record<ThemeColorKey, string>

export interface ThemePreset {
  id: ThemePresetId
  light: ThemePresetColors
  dark: ThemePresetColors
}

type BrandColors = Pick<
  ThemePresetColors,
  'primary_color' | 'secondary_color' | 'info_color'
>

const LIGHT_BASE: Omit<ThemePresetColors, keyof BrandColors> = {
  primary_text: '#1A1C1E',
  secondary_text: '#44474E',
  error_color: '#E53935',
  warning_color: '#FFA726',
  success_color: '#43A047',
}

const DARK_BASE: Omit<ThemePresetColors, keyof BrandColors> = {
  primary_text: '#E2E2E6',
  secondary_text: '#C4C6D0',
  error_color: '#EF5350',
  warning_color: '#FFB74D',
  success_color: '#66BB6A',
}

const pickColors = (theme: typeof defaultTheme): ThemePresetColors => ({
  primary_color: theme.primary_color,
  secondary_color: theme.secondary_color,
  primary_text: theme.primary_text,
  secondary_text: theme.secondary_text,
  info_color: theme.info_color,
  error_color: theme.error_color,
  warning_color: theme.warning_color,
  success_color: theme.success_color,
})

const makePreset = (
  id: ThemePresetId,
  light: BrandColors,
  dark: BrandColors,
): ThemePreset => ({
  id,
  light: { ...LIGHT_BASE, ...light },
  dark: { ...DARK_BASE, ...dark },
})

export const THEME_PRESETS: readonly ThemePreset[] = [
  {
    id: 'default',
    light: pickColors(defaultTheme),
    dark: pickColors(defaultDarkTheme),
  },
  makePreset(
    'ocean',
    {
      primary_color: '#26A69A',
      secondary_color: '#4DD0E1',
      info_color: '#42A5F5',
    },
    {
      primary_color: '#26A69A',
      secondary_color: '#80DEEA',
      info_color: '#64B5F6',
    },
  ),
  makePreset(
    'indigo',
    {
      primary_color: '#3949AB',
      secondary_color: '#5C6BC0',
      info_color: '#26C6DA',
    },
    {
      primary_color: '#5C6BC0',
      secondary_color: '#7986CB',
      info_color: '#4DD0E1',
    },
  ),
  makePreset(
    'sunset',
    {
      primary_color: '#D81B60',
      secondary_color: '#AB47BC',
      info_color: '#00ACC1',
    },
    {
      primary_color: '#D81B60',
      secondary_color: '#CE93D8',
      info_color: '#4DD0E1',
    },
  ),
  makePreset(
    'lavender',
    {
      primary_color: '#7E57C2',
      secondary_color: '#9575CD',
      info_color: '#42A5F5',
    },
    {
      primary_color: '#7E57C2',
      secondary_color: '#B39DDB',
      info_color: '#64B5F6',
    },
  ),
  makePreset(
    'monochrome',
    {
      primary_color: '#607D8B',
      secondary_color: '#78909C',
      info_color: '#42A5F5',
    },
    {
      primary_color: '#607D8B',
      secondary_color: '#90A4AE',
      info_color: '#64B5F6',
    },
  ),
]
