import { useClashConfigData } from '@/hooks/data/use-clash-config-data'
import { useClashInfo } from '@/hooks/use-clash'
import { useVerge } from '@/hooks/use-verge'
import { resolveDisplayedMixedPort } from '@/utils/mixed-port'

export const useDisplayedMixedPort = () => {
  const { clashConfig } = useClashConfigData()
  const { clashInfo } = useClashInfo()
  const { verge } = useVerge()

  return resolveDisplayedMixedPort({
    live: clashConfig?.mixedPort,
    selected: verge?.verge_mixed_port,
    merge: clashInfo?.mixed_port,
  })
}
