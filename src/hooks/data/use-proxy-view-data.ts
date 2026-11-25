import { useEffect } from 'react'

import { getProxyView } from '@/services/cmds'
import { revalidateQuery, useQuery } from '@/services/query-client'

import { createPollingGroup } from './proxy-view-polling'
import { APP_DATA_QUERY_KEYS, MIHOMO_QUERY_OPTIONS } from './query-options'

const PROXY_VIEW_REFETCH_MS = 15000

/**
 * Bounded staleness for surfaces that only summarise topology; proxy events
 * revalidate the view on selection and core changes.
 */
export const HOME_PROXY_VIEW_REFETCH_MS = 60000

// Every consumer shares the same SWR cache, so they also share one timer.
const proxyViewPoller = createPollingGroup(() => {
  void revalidateQuery(APP_DATA_QUERY_KEYS.proxyView)
})

/** Live proxy topology, polled while the proxies page is mounted. */
export const useProxiesData = (
  refetchInterval: number | false = PROXY_VIEW_REFETCH_MS,
) => {
  useEffect(() => {
    if (!refetchInterval) return
    return proxyViewPoller.subscribe(refetchInterval)
  }, [refetchInterval])

  const {
    data: proxyView,
    error,
    isPending,
  } = useQuery({
    queryKey: APP_DATA_QUERY_KEYS.proxyView,
    queryFn: getProxyView,
    refetchInterval: false,
    ...MIHOMO_QUERY_OPTIONS,
  })

  return {
    proxyView,
    isProxyViewPending: isPending,
    isProxyViewError: Boolean(error),
  }
}
