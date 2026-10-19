import type { AnyRouter } from '@tanstack/react-router'
import {
  getBaseConfig,
  getRuleProviders,
  getRules,
} from 'tauri-plugin-mihomo-api'

import { NAV_ITEMS } from '@/config/navigation'
import { APP_DATA_QUERY_KEYS } from '@/hooks/data/query-options'
import { getProxyView, getSystemProxy } from '@/services/cmds'
import { fetchCacheData } from '@/services/query-client'

/**
 * Best-effort warmup after the first paint: the routes are code-split, so a
 * cold page switch pays for the chunk fetch and the data query. Preloading
 * both during idle keeps the first switch as immediate as the eager router it
 * replaced, without blocking startup or showing a loading overlay.
 */
const IDLE_TIMEOUT_MS = 3000

const runWhenIdle = (callback: () => void) => {
  if (typeof window === 'undefined') return
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(callback, { timeout: IDLE_TIMEOUT_MS })
    return
  }
  window.setTimeout(callback, 1000)
}

export const prefetchRouteChunks = async (router: AnyRouter) => {
  for (const item of NAV_ITEMS) {
    try {
      await router.preloadRoute({ to: item.path })
    } catch (error) {
      console.warn(`[warmup] route preload failed: ${item.path}`, error)
    }
  }
}

/**
 * These routes wrap their page in lazyRouteComponent; preloading the route
 * does not always resolve the React lazy component, which would suspend on the
 * first visit after navigation.
 */
const prefetchLazyPageModules = () =>
  Promise.allSettled([
    import('@/pages/profiles'),
    import('@/pages/settings'),
    import('@/pages/connections'),
  ])

const prewarmCommonQueries = async () => {
  const queries: ReadonlyArray<[readonly string[], () => Promise<unknown>]> = [
    [APP_DATA_QUERY_KEYS.proxyView, getProxyView],
    [APP_DATA_QUERY_KEYS.clashConfig, getBaseConfig],
    [APP_DATA_QUERY_KEYS.ruleProviders, getRuleProviders],
    [APP_DATA_QUERY_KEYS.rules, getRules],
    [APP_DATA_QUERY_KEYS.sysproxy, getSystemProxy],
  ]

  for (const [key, fetcher] of queries) {
    try {
      await fetchCacheData(key, fetcher)
    } catch (error) {
      console.warn(`[warmup] query prewarm failed: ${key.join('.')}`, error)
    }
  }
}

let scheduled = false

export const scheduleWarmup = (router: AnyRouter) => {
  if (scheduled) return
  scheduled = true

  runWhenIdle(() => {
    void prefetchRouteChunks(router)
      .then(() => prefetchLazyPageModules())
      .then(() => {
        runWhenIdle(() => {
          void prewarmCommonQueries()
        })
      })
  })
}
