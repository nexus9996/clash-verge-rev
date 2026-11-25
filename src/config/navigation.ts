import type { TranslationKey } from '@/types/generated/i18n-keys'

/**
 * Single source of truth for the sidebar navigation: id, path and i18n label.
 * Route files point at an entry through `staticData.navId`, so adding a page
 * means touching the page, its route shell and this catalog only.
 */
const NAV_META = {
  home: { path: '/', labelKey: 'layout.components.navigation.tabs.home' },
  proxies: {
    path: '/proxies',
    labelKey: 'layout.components.navigation.tabs.proxies',
  },
  profiles: {
    path: '/profile',
    labelKey: 'layout.components.navigation.tabs.profiles',
  },
  connections: {
    path: '/connections',
    labelKey: 'layout.components.navigation.tabs.connections',
  },
  rules: {
    path: '/rules',
    labelKey: 'layout.components.navigation.tabs.rules',
  },
  logs: {
    path: '/logs',
    labelKey: 'layout.components.navigation.tabs.logs',
  },
  unlock: {
    path: '/unlock',
    labelKey: 'layout.components.navigation.tabs.unlock',
  },
  settings: {
    path: '/settings',
    labelKey: 'layout.components.navigation.tabs.settings',
  },
} as const satisfies Record<string, { path: string; labelKey: TranslationKey }>

export type NavigationId = keyof typeof NAV_META

export type NavigationPath = (typeof NAV_META)[NavigationId]['path']

type NavigationLabelKey = (typeof NAV_META)[NavigationId]['labelKey']

export interface NavigationItem {
  id: NavigationId
  path: NavigationPath
  labelKey: NavigationLabelKey
}

/** Default order. Users may reorder entries through `verge.menu_order` (by path). */
const NAV_IDS = Object.keys(NAV_META) as NavigationId[]

export const NAV_ITEMS: NavigationItem[] = NAV_IDS.map((id) => ({
  id,
  ...NAV_META[id],
}))

const NAV_ITEM_BY_PATH = new Map<string, NavigationItem>(
  NAV_ITEMS.map((item) => [item.path, item]),
)

const isNavigationPath = (path: string): path is NavigationPath =>
  NAV_ITEM_BY_PATH.has(path)

/**
 * Maps a backend-provided navigation string (notices, tray actions, deep links)
 * onto a typed route path. Unknown paths fall back to the home route instead of
 * crashing the router.
 */
export const resolveNavigationPath = (path: string): NavigationPath => {
  if (isNavigationPath(path)) return path

  console.warn(`[navigation] unknown route path: ${path}`)
  return '/'
}

declare module '@tanstack/react-router' {
  interface StaticDataRouteOption {
    navId?: NavigationId
  }
}
