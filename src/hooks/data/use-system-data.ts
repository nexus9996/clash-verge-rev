import { useMemo } from 'react'

import { useDisplayedMixedPort } from '@/hooks/use-displayed-mixed-port'
import { useVerge } from '@/hooks/use-verge'
import { getSystemProxyState } from '@/services/cmds'
import { useQuery } from '@/services/query-client'
import { useRunState } from '@/store/app-store-context'

import { APP_DATA_QUERY_KEYS, DEFAULT_QUERY_OPTIONS } from './query-options'

export const useSystemData = () => {
  const { verge } = useVerge()
  // System and PAC proxy are one OS read; the indicator reports observed state,
  // so the pair is re-read whenever the window regains focus.
  const { data: systemProxyState } = useQuery({
    queryKey: APP_DATA_QUERY_KEYS.systemProxyState,
    queryFn: getSystemProxyState,
    ...DEFAULT_QUERY_OPTIONS,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  })
  const sysproxy = systemProxyState?.sysproxy
  const autoproxy = systemProxyState?.autoproxy

  // Store-owned run state; the event bus and the store's safety net write it.
  const runState = useRunState()
  const runningMode = runState?.mode
  const isRunningModePending = runState == null

  const displayedMixedPort = useDisplayedMixedPort()

  return useMemo(() => {
    const calculateSystemProxyAddress = () => {
      if (!verge) return '-'

      const isPacMode = verge.proxy_auto_config ?? false
      const proxyHost = verge.proxy_host || '127.0.0.1'

      if (!isPacMode) {
        const systemServer = sysproxy?.server
        if (
          systemServer &&
          systemServer !== '-' &&
          !systemServer.startsWith(':')
        ) {
          return systemServer
        }
      }

      return `${proxyHost}:${displayedMixedPort}`
    }

    return {
      sysproxy,
      autoproxy,
      runningMode,
      isRunningModePending,
      systemProxyAddress: calculateSystemProxyAddress(),
    }
  }, [
    sysproxy,
    autoproxy,
    runningMode,
    isRunningModePending,
    verge,
    displayedMixedPort,
  ])
}
