import { useMemo } from 'react'

import { revalidateQuery } from '@/services/query-client'

import { APP_DATA_QUERY_KEYS } from './query-options'

type Revalidate = (queryKey: readonly unknown[]) => Promise<unknown>

/**
 * Refreshers are plain cache revalidations, so they no longer need a provider:
 * every consumer reads the same SWR keys.
 */
export const createAppRefreshers = (
  revalidate: Revalidate = revalidateQuery,
) => ({
  refreshProxy: () => revalidate(APP_DATA_QUERY_KEYS.proxyView),
  refreshClashConfig: () => revalidate(APP_DATA_QUERY_KEYS.clashConfig),
  refreshRules: () => revalidate(APP_DATA_QUERY_KEYS.rules),
  refreshSysproxy: () => revalidate(APP_DATA_QUERY_KEYS.sysproxy),
  refreshRuleProviders: () => revalidate(APP_DATA_QUERY_KEYS.ruleProviders),
  refreshAll: () =>
    Promise.all([
      revalidate(APP_DATA_QUERY_KEYS.proxyView),
      revalidate(APP_DATA_QUERY_KEYS.clashConfig),
      revalidate(APP_DATA_QUERY_KEYS.rules),
      revalidate(APP_DATA_QUERY_KEYS.sysproxy),
      revalidate(APP_DATA_QUERY_KEYS.ruleProviders),
    ]),
})

const APP_DATA_REFRESHERS = createAppRefreshers()

/** Stable refresher object; all consumers share the same cache targets. */
export const useAppRefreshers = () => useMemo(() => APP_DATA_REFRESHERS, [])
