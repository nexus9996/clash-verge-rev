import { useMemo } from 'react'

import { useDisplayedMixedPort } from '@/hooks/use-displayed-mixed-port'
import { useVerge } from '@/hooks/use-verge'
import { getSystemProxy } from '@/services/cmds'
import { useQuery } from '@/services/query-client'
import { useRunState } from '@/store/app-store-context'

import { APP_DATA_QUERY_KEYS, DEFAULT_QUERY_OPTIONS } from './query-options'

export const useSystemData = () => {
  const { verge } = useVerge()
  const { data: sysproxy } = useQuery({
    queryKey: APP_DATA_QUERY_KEYS.sysproxy,
    queryFn: getSystemProxy,
    ...DEFAULT_QUERY_OPTIONS,
  })

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
      runningMode,
      isRunningModePending,
      systemProxyAddress: calculateSystemProxyAddress(),
    }
  }, [sysproxy, runningMode, isRunningModePending, verge, displayedMixedPort])
}
