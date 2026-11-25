import { useClashConfigData } from './use-clash-config-data'
import { useProxiesData } from './use-proxy-view-data'

/**
 * Cross-cutting loading flag derived from the domain queries.
 *
 * Pagers that need live topology own their own polling interval; a status
 * flag must not start a second timer for the same query key.
 */
export const useCoreDataStatus = (refetchInterval: number | false = false) => {
  const { isClashConfigPending } = useClashConfigData()
  const { isProxyViewPending } = useProxiesData(refetchInterval)

  return {
    isCoreDataPending: isProxyViewPending || isClashConfigPending,
  }
}
