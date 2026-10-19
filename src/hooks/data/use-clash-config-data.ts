import { getBaseConfig } from 'tauri-plugin-mihomo-api'

import { useQuery } from '@/services/query-client'

import { APP_DATA_QUERY_KEYS, MIHOMO_QUERY_OPTIONS } from './query-options'

export const useClashConfigData = () => {
  const { data: clashConfig, isPending: isClashConfigPending } = useQuery({
    queryKey: APP_DATA_QUERY_KEYS.clashConfig,
    queryFn: getBaseConfig,
    ...MIHOMO_QUERY_OPTIONS,
  })

  return { clashConfig, isClashConfigPending }
}
