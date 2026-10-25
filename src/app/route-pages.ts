import type { ComponentType } from 'react'

import type { NavigationId } from '@/config/navigation'

import HomePage from '@/pages/home'

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
 * Route components keyed by navigation id. All pages except the home screen
 * are split out of the initial bundle and preloaded on intent, so first paint
 * only pays for the route the app opens on.
 */
export const PAGE_ROUTES: Record<NavigationId, PageRoute> = {
  home: { Component: HomePage },
  proxies: { lazy: lazyPage(() => import('@/pages/proxies')) },
  profiles: { lazy: lazyPage(() => import('@/pages/profiles')) },
  connections: { lazy: lazyPage(() => import('@/pages/connections')) },
  rules: { lazy: lazyPage(() => import('@/pages/rules')) },
  logs: { lazy: lazyPage(() => import('@/pages/logs')) },
  unlock: { lazy: lazyPage(() => import('@/pages/unlock')) },
  settings: { lazy: lazyPage(() => import('@/pages/settings')) },
}

/** Warms a split page chunk on hover/focus so navigation stays instant. */
export const preloadPage = (id: NavigationId) => {
  void PAGE_ROUTES[id].lazy?.().catch(() => {})
}
