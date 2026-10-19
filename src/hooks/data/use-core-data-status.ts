import { useClashConfigData } from './use-clash-config-data'
import { useProxiesData } from './use-proxy-view-data'

/** Cross-cutting loading flag derived from the domain queries. */
export const useCoreDataStatus = () => {
  const { isClashConfigPending } = useClashConfigData()
  const { isProxyViewPending } = useProxiesData()

  return {
    isCoreDataPending: isProxyViewPending || isClashConfigPending,
  }
}
