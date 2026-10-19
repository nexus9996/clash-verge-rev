import { getProxyView } from '@/services/cmds'
import { useQuery } from '@/services/query-client'

import { APP_DATA_QUERY_KEYS, MIHOMO_QUERY_OPTIONS } from './query-options'

/** Live proxy topology, polled while the proxies page is mounted. */
export const useProxiesData = () => {
  const {
    data: proxyView,
    error,
    isPending,
  } = useQuery({
    queryKey: APP_DATA_QUERY_KEYS.proxyView,
    queryFn: getProxyView,
    refetchInterval: 15000,
    refetchIntervalInBackground: false,
    ...MIHOMO_QUERY_OPTIONS,
  })

  return {
    proxyView,
    isProxyViewPending: isPending,
    isProxyViewError: Boolean(error),
  }
}
