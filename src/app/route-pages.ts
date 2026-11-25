import type { ComponentType } from 'react'

import type { NavigationId } from '@/config/navigation'

import HomePage from '@/pages/home'
import LogsPage from '@/pages/logs'
import ProxiesPage from '@/pages/proxies'
import RulesPage from '@/pages/rules'
import UnlockPage from '@/pages/unlock'

interface PageModule {
  Component: ComponentType
}

interface PageRoute {
  Component?: ComponentType
  lazy?: () => Promise<PageModule>
}

const lazyPage = (load: () => Promise<{ default: ComponentType }>) => () =>
  load().then((module) => ({ Component: module.default }))

/**
 * Route components keyed by navigation id. The three largest pages are split
 * out of the initial bundle (C6) and preloaded on intent; the rest stay eager
 * so a route switch never shows a loading state.
 */
export const PAGE_ROUTES: Record<NavigationId, PageRoute> = {
  home: { Component: HomePage },
  proxies: { Component: ProxiesPage },
  profiles: { lazy: lazyPage(() => import('@/pages/profiles')) },
  connections: { lazy: lazyPage(() => import('@/pages/connections')) },
  rules: { Component: RulesPage },
  logs: { Component: LogsPage },
  unlock: { Component: UnlockPage },
  settings: { lazy: lazyPage(() => import('@/pages/settings')) },
}

/** Warms a split page chunk on hover/focus so navigation stays instant. */
export const preloadPage = (id: NavigationId) => {
  void PAGE_ROUTES[id].lazy?.().catch(() => {})
}
