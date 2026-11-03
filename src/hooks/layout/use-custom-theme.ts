import {
  createTheme,
  Theme as MuiTheme,
  Shadows,
  type ThemeOptions,
} from '@mui/material'
import {
  getCurrentWebviewWindow,
  WebviewWindow,
} from '@tauri-apps/api/webviewWindow'
import { Theme as TauriOsTheme } from '@tauri-apps/api/window'
import { useEffect, useMemo } from 'react'

import {
  createThemeCssVariables,
  defaultDarkTheme,
  defaultTheme,
  MOTION,
  RADIUS,
  resolveModeSurfaces,
  resolveThemeColors,
  SHADOW,
  SPACE,
  type ResolvedThemeColors,
} from '@/config/theme'
import { useVerge } from '@/hooks/use-verge'
import { setNativeWindowTheme } from '@/services/cmds'
import { useSetThemeMode, useThemeMode } from '@/services/states'

const CSS_INJECTION_SCOPE_ROOT = '[data-css-injection-root]'
const CSS_INJECTION_SCOPE_LIMIT =
  ':is(.monaco-editor .view-lines, .monaco-editor .view-line, .monaco-editor .margin, .monaco-editor .margin-view-overlays, .monaco-editor .view-overlays, .monaco-editor [class^="mtk"], .monaco-editor [class*=" mtk"])'
const TOP_LEVEL_AT_RULES = [
  '@charset',
  '@import',
  '@namespace',
  '@font-face',
  '@keyframes',
  '@counter-style',
  '@page',
  '@property',
  '@font-feature-values',
  '@color-profile',
]
const THEME_BREAKPOINTS = {
  values: { xs: 0, sm: 650, md: 900, lg: 1200, xl: 1536 },
} as const

const MOTION_TRANSITION = [
  'background-color',
  'border-color',
  'color',
  'box-shadow',
  'transform',
]
  .map((property) => `${property} ${MOTION.fast} ${MOTION.standard}`)
  .join(', ')

const buildThemeOptions = (
  mode: 'light' | 'dark',
  colors: ResolvedThemeColors,
): ThemeOptions => {
  const surfaces = resolveModeSurfaces(mode)

  return {
    breakpoints: THEME_BREAKPOINTS,
    palette: {
      mode,
      primary: { main: colors.primary },
      secondary: { main: colors.secondary },
      info: { main: colors.info },
      error: { main: colors.error },
      warning: { main: colors.warning },
      success: { main: colors.success },
      text: {
        primary: colors.textPrimary,
        secondary: colors.textSecondary,
      },
      background: {
        paper: colors.paper,
        default: colors.background,
      },
    },
    shadows: Array(25).fill('none') as Shadows,
    typography: {
      fontFamily: colors.fontFamily,
      button: { textTransform: 'none', fontWeight: 600 },
    },
    shape: { borderRadius: RADIUS.sm },
    components: {
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: {
            borderRadius: RADIUS.sm,
            fontWeight: 600,
            transition: MOTION_TRANSITION,
          },
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: { borderRadius: RADIUS.sm, transition: MOTION_TRANSITION },
        },
      },
      MuiListItemButton: {
        styleOverrides: { root: { transition: MOTION_TRANSITION } },
      },
      MuiMenuItem: {
        styleOverrides: {
          root: {
            borderRadius: RADIUS.xs,
            marginInline: SPACE.xxs,
            transition: MOTION_TRANSITION,
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
            transition: `background-color ${MOTION.base} ${MOTION.standard}`,
          },
          rounded: { borderRadius: RADIUS.md },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            backgroundImage: 'none',
            borderRadius: RADIUS.lg,
            border: `1px solid ${surfaces.divider}`,
            boxShadow: SHADOW.lg,
          },
        },
      },
      MuiPopover: {
        styleOverrides: {
          paper: {
            backgroundImage: 'none',
            borderRadius: RADIUS.md,
            border: `1px solid ${surfaces.divider}`,
            boxShadow: SHADOW.md,
          },
        },
      },
      MuiMenu: {
        styleOverrides: {
          paper: {
            backgroundImage: 'none',
            borderRadius: RADIUS.md,
            border: `1px solid ${surfaces.divider}`,
            boxShadow: SHADOW.md,
          },
        },
      },
      MuiTooltip: {
        styleOverrides: {
          tooltip: {
            borderRadius: RADIUS.sm,
            padding: `${SPACE.xs}px ${SPACE.sm}px`,
            fontSize: 12,
            lineHeight: 1.5,
            color: colors.textPrimary,
            backgroundColor: surfaces.raisedBackground,
            border: `1px solid ${surfaces.divider}`,
            boxShadow: SHADOW.md,
          },
        },
      },
      MuiLinearProgress: {
        styleOverrides: {
          root: { borderRadius: RADIUS.pill, overflow: 'hidden' },
          bar: { borderRadius: RADIUS.pill },
        },
      },
      MuiAlert: {
        styleOverrides: { root: { borderRadius: RADIUS.md } },
      },
      MuiCard: {
        styleOverrides: {
          root: { borderRadius: RADIUS.md, backgroundImage: 'none' },
        },
      },
      MuiTab: {
        styleOverrides: {
          root: { textTransform: 'none', fontWeight: 600 },
        },
      },
      MuiDialogTitle: {
        styleOverrides: {
          root: { fontWeight: 700, letterSpacing: '-0.01em' },
        },
      },
      MuiDialogActions: {
        styleOverrides: {
          root: { padding: `${SPACE.sm}px ${SPACE.lg}px ${SPACE.lg}px` },
        },
      },
    },
  }
}

let cssScopeSupport: boolean | null = null

const canUseCssScope = () => {
  if (cssScopeSupport !== null) {
    return cssScopeSupport
  }
  try {
    const testStyle = document.createElement('style')
    testStyle.textContent = '@scope (:root) { }'
    document.head.appendChild(testStyle)
    cssScopeSupport = !!testStyle.sheet?.cssRules?.length
    document.head.removeChild(testStyle)
  } catch {
    cssScopeSupport = false
  }
  return cssScopeSupport
}

const wrapCssInjectionWithScope = (css?: string) => {
  if (!css?.trim()) {
    return ''
  }
  const lowerCss = css.toLowerCase()
  const hasTopLevelOnlyRule = TOP_LEVEL_AT_RULES.some((rule) =>
    lowerCss.includes(rule),
  )
  if (hasTopLevelOnlyRule) {
    return null
  }
  const scopeRoot = CSS_INJECTION_SCOPE_ROOT
  const scopeLimit = `${CSS_INJECTION_SCOPE_LIMIT} > *`
  const scopedBlock = `@scope (${scopeRoot}) to (${scopeLimit}) {
${css}
}`
  return scopedBlock
}

/**
 * custom theme
 */
export const useCustomTheme = () => {
  const appWindow: WebviewWindow = useMemo(() => getCurrentWebviewWindow(), [])
  const { verge } = useVerge()
  const { theme_mode, theme_setting, light_theme_setting, dark_theme_setting } =
    verge ?? {}
  const mode = useThemeMode()
  const setMode = useSetThemeMode()
  const modeThemeSetting =
    (mode === 'light' ? light_theme_setting : dark_theme_setting) ??
    theme_setting
  const userBackgroundImage =
    modeThemeSetting?.background_image || theme_setting?.background_image || ''
  const hasUserBackground = !!userBackgroundImage

  useEffect(() => {
    if (theme_mode === 'light' || theme_mode === 'dark') {
      setMode(theme_mode)
    }
  }, [theme_mode, setMode])

  useEffect(() => {
    if (theme_mode !== 'system') {
      return
    }

    let isMounted = true

    const timerId = setTimeout(() => {
      if (!isMounted) return
      appWindow
        .theme()
        .then((systemTheme) => {
          if (isMounted && systemTheme) {
            setMode(systemTheme)
          }
        })
        .catch((err) => {
          console.error('Failed to get initial system theme:', err)
        })
    }, 0)

    const unlistenPromise = appWindow.onThemeChanged(({ payload }) => {
      if (isMounted) {
        setMode(payload)
      }
    })

    return () => {
      isMounted = false
      clearTimeout(timerId)
      unlistenPromise
        .then((unlistenFn) => {
          if (typeof unlistenFn === 'function') {
            unlistenFn()
          }
        })
        .catch((err) => {
          console.error('Failed to unlisten from theme changes:', err)
        })
    }
  }, [theme_mode, appWindow, setMode])

  useEffect(() => {
    if (theme_mode === undefined || theme_mode === null) {
      return
    }

    if (theme_mode === 'system') {
      appWindow.setTheme(null).catch((err) => {
        console.error(
          'Failed to set window theme to follow system (setTheme(null)):',
          err,
        )
      })
    } else if (mode) {
      appWindow.setTheme(mode as TauriOsTheme).catch((err) => {
        console.error(`Failed to set window theme to ${mode}:`, err)
      })
    }

    if (mode) {
      setNativeWindowTheme(mode).catch((err) => {
        console.error('Failed to set native window theme:', err)
      })
    }
  }, [mode, appWindow, theme_mode])

  const theme = useMemo(() => {
    const setting =
      (mode === 'light' ? light_theme_setting : dark_theme_setting) ??
      theme_setting ??
      {}
    const dt = mode === 'light' ? defaultTheme : defaultDarkTheme
    const colors = resolveThemeColors(setting, dt)
    let muiTheme: MuiTheme

    try {
      muiTheme = createTheme(buildThemeOptions(mode, colors))
    } catch (e) {
      console.error('Error creating MUI theme, falling back to defaults:', e)
      muiTheme = createTheme(
        buildThemeOptions(mode, resolveThemeColors(undefined, dt)),
      )
    }

    const rootEle = document.documentElement
    if (rootEle) {
      const cssVariables = createThemeCssVariables({ mode, setting, colors })
      for (const [name, value] of Object.entries(cssVariables)) {
        rootEle.style.setProperty(name, value)
      }
      rootEle.style.setProperty('background-color', colors.background)
      rootEle.style.setProperty(
        '--user-background-image',
        hasUserBackground ? `url('${userBackgroundImage}')` : 'none',
      )
      rootEle.style.setProperty(
        '--background-blend-mode',
        setting.background_blend_mode || 'normal',
      )
      rootEle.style.setProperty(
        '--background-opacity',
        setting.background_opacity !== undefined
          ? String(setting.background_opacity)
          : '1',
      )
      rootEle.setAttribute('data-css-injection-root', 'true')
    }

    let styleElement = document.querySelector('style#verge-theme')
    if (!styleElement) {
      styleElement = document.createElement('style')
      styleElement.id = 'verge-theme'
      document.head.appendChild(styleElement!)
    }

    if (styleElement) {
      let scopedCss: string | null = null
      if (canUseCssScope() && setting.css_injection) {
        scopedCss = wrapCssInjectionWithScope(setting.css_injection)
      }
      const effectiveInjectedCss = scopedCss ?? setting.css_injection ?? ''
      const globalStyles = `
        /* 细圆角滚动条：轨道透明、滑块留内边距，明暗主题共用 */
        ::-webkit-scrollbar {
          width: 10px;
          height: 10px;
          background-color: transparent;
        }
        ::-webkit-scrollbar-track,
        ::-webkit-scrollbar-corner {
          background-color: transparent;
        }
        ::-webkit-scrollbar-thumb {
          background-color: var(--scrollbar-thumb);
          border: 2px solid transparent;
          border-radius: var(--radius-pill);
          background-clip: padding-box;
          transition: background-color var(--motion-fast) var(--motion-standard);
        }
        ::-webkit-scrollbar-thumb:hover {
          background-color: var(--scrollbar-thumb-hover);
        }

        /* 背景图处理 */
        body {
          font-family: ${colors.fontFamily};
          background-color: var(--background-color);
          transition: background-color var(--motion-base) var(--motion-standard);
          ${
            hasUserBackground
              ? `
            background-image: var(--user-background-image);
            background-size: cover;
            background-position: center;
            background-attachment: fixed;
            background-blend-mode: var(--background-blend-mode);
            opacity: var(--background-opacity);
          `
              : ''
          }
        }

        /* 修复可能的白色边框 */
        .MuiPaper-root {
          border-color: var(--window-border-color) !important;
        }

        /* 确保模态框和对话框也使用暗色主题 */
        .MuiDialog-paper {
          background-color: var(--dialog-background) !important;
        }

        /* 键盘用户可见的焦点环；鼠标点击不显示默认轮廓 */
        :focus:not(:focus-visible) {
          outline: none;
        }
        :focus-visible {
          outline: 2px solid var(--color-primary);
          outline-offset: 2px;
        }

        /* 尊重系统的“减少动态效果”设置 */
        @media (prefers-reduced-motion: reduce) {
          *,
          *::before,
          *::after {
            animation-duration: 0.01ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: 0.01ms !important;
            scroll-behavior: auto !important;
          }
        }
      `

      styleElement.innerHTML = effectiveInjectedCss + globalStyles
    }

    return muiTheme
  }, [
    mode,
    theme_setting,
    light_theme_setting,
    dark_theme_setting,
    userBackgroundImage,
    hasUserBackground,
  ])

  useEffect(() => {
    const id = setTimeout(() => {
      const dom = document.querySelector('#Gradient2')
      if (dom) {
        dom.innerHTML = `
        <stop offset="0%" stop-color="${theme.palette.primary.main}" />
        <stop offset="80%" stop-color="${theme.palette.primary.dark}" />
        <stop offset="100%" stop-color="${theme.palette.primary.dark}" />
        `
      }
    }, 0)
    return () => clearTimeout(id)
  }, [theme.palette.primary.main, theme.palette.primary.dark])

  return { theme }
}
