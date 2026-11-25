import type { ComponentType } from 'react'

import type { NavigationId } from '@/config/navigation'
import type { LanguageSection } from '@/services/i18n'

import HomePage from '@/pages/home'
import { ensureLanguageSections } from '@/services/i18n'

interface PageModule {
  Component: ComponentType
}

interface PageRoute {
  Component?: ComponentType
  lazy?: () => Promise<PageModule>
}

/** `home` renders eagerly, so its sections are loaded at startup instead. */
type SplitPageId = Exclude<NavigationId, 'home'>

/**
 * Locale sections each split page renders, mirroring the `useTranslation` keys
 * of the page and its `src/components/<domain>` folder, including the editors a
 * page pulls in from another domain (`profiles` opens the `settings` config
 * viewer, `settings` opens the `profiles` editors).
 */
const PAGE_LANGUAGE_SECTIONS: Record<SplitPageId, readonly LanguageSection[]> =
  {
    proxies: ['proxies', 'shared'],
    profiles: ['profiles', 'proxies', 'rules', 'settings', 'shared'],
    connections: ['connections', 'shared'],
    rules: ['rules', 'shared'],
    logs: ['logs', 'shared'],
    unlock: ['tests', 'shared'],
    settings: ['settings', 'profiles', 'shared'],
  }

/**
 * Resolves the page chunk together with its locale sections: react-router gates
 * the render on this promise, so a page never mounts with raw translation keys.
 */
const lazyPage =
  (id: SplitPageId, load: () => Promise<{ default: ComponentType }>) =>
  async () => {
    const [, page] = await Promise.all([
      ensureLanguageSections(PAGE_LANGUAGE_SECTIONS[id]),
      load(),
    ])

    return { Component: page.default }
  }

/**
 * Route components keyed by navigation id. All pages except the home screen
 * are split out of the initial bundle and preloaded on intent, so first paint
 * only pays for the route the app opens on.
 */
export const PAGE_ROUTES: Record<NavigationId, PageRoute> = {
  home: { Component: HomePage },
  proxies: { lazy: lazyPage('proxies', () => import('@/pages/proxies')) },
  profiles: { lazy: lazyPage('profiles', () => import('@/pages/profiles')) },
  connections: {
    lazy: lazyPage('connections', () => import('@/pages/connections')),
  },
  rules: { lazy: lazyPage('rules', () => import('@/pages/rules')) },
  logs: { lazy: lazyPage('logs', () => import('@/pages/logs')) },
  unlock: { lazy: lazyPage('unlock', () => import('@/pages/unlock')) },
  settings: { lazy: lazyPage('settings', () => import('@/pages/settings')) },
}

/** Warms a split page chunk and its locale sections on hover/focus preview. */
export const preloadPage = (id: NavigationId) => {
  void PAGE_ROUTES[id].lazy?.().catch(() => {})
}
