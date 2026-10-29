import {
  createThemeCssVariables,
  defaultDarkTheme,
  defaultTheme,
  resolveThemeColors,
} from '@/config/theme'

export type QuickPanelThemeMode = 'light' | 'dark'

type QuickPanelThemeSetting = Parameters<typeof resolveThemeColors>[0]

const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)'

const systemPrefersDark = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia(DARK_SCHEME_QUERY).matches

/**
 * Resolves the configured `theme_mode` to the concrete mode the standalone
 * quick panel renders in. `system` (or an unknown value) follows the webview
 * appearance, which tracks the OS theme once the popover no longer pins a
 * dark appearance.
 */
export const resolveQuickPanelThemeMode = (
  themeMode?: string | null,
): QuickPanelThemeMode => {
  if (themeMode === 'light' || themeMode === 'dark') return themeMode
  return systemPrefersDark() ? 'dark' : 'light'
}

/**
 * Per-mode overrides with the same fallback order as the main window:
 * `light_theme_setting`/`dark_theme_setting`, then the shared `theme_setting`.
 */
export const resolveQuickPanelThemeSetting = (
  verge: IVergeConfig | null | undefined,
  mode: QuickPanelThemeMode,
): QuickPanelThemeSetting =>
  (mode === 'light' ? verge?.light_theme_setting : verge?.dark_theme_setting) ??
  verge?.theme_setting ??
  undefined

/**
 * Writes the generated theme variables onto the standalone webview root so
 * quick-panel.css consumes the same tokens as the main window. The quick panel
 * owns its own webview, so it cannot inherit the variables the main window sets
 * in `useCustomTheme`; it reuses the token factory instead of redeclaring
 * colors locally.
 */
export const applyQuickPanelTheme = (
  mode: QuickPanelThemeMode,
  setting?: QuickPanelThemeSetting,
): void => {
  if (typeof document === 'undefined') return
  const defaults = mode === 'light' ? defaultTheme : defaultDarkTheme
  const colors = resolveThemeColors(setting, defaults)
  const variables = createThemeCssVariables({ mode, setting, colors })
  const root = document.documentElement
  for (const [name, value] of Object.entries(variables)) {
    root.style.setProperty(name, value)
  }
  root.style.setProperty('color-scheme', mode)
}
