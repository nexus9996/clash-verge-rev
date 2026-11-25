import { getProxyView } from '@/services/cmds'
import { useQuery } from '@/services/query-client'

import { APP_DATA_QUERY_KEYS, MIHOMO_QUERY_OPTIONS } from './query-options'

const PROXY_VIEW_REFETCH_MS = 15000

/**
 * Bounded staleness for surfaces that only summarise topology; proxy events
 * revalidate the view on selection and core changes.
 */
export const HOME_PROXY_VIEW_REFETCH_MS = 60000

/** Live proxy topology, polled while the proxies page is mounted. */
export const useProxiesData = (
  refetchInterval: number | false = PROXY_VIEW_REFETCH_MS,
) => {
  const {
    data: proxyView,
    error,
    isPending,
  } = useQuery({
    queryKey: APP_DATA_QUERY_KEYS.proxyView,
    queryFn: getProxyView,
    refetchInterval,
    refetchIntervalInBackground: false,
    ...MIHOMO_QUERY_OPTIONS,
  })

  return {
    proxyView,
    isProxyViewPending: isPending,
    isProxyViewError: Boolean(error),
  }
}
