import type { RuleProvider } from 'tauri-plugin-mihomo-api'
import { getRuleProviders, getRules } from 'tauri-plugin-mihomo-api'

import { useQuery } from '@/services/query-client'

import { APP_DATA_QUERY_KEYS, MIHOMO_QUERY_OPTIONS } from './query-options'

export const useRulesData = () => {
  const { data: ruleProviders } = useQuery({
    queryKey: APP_DATA_QUERY_KEYS.ruleProviders,
    queryFn: getRuleProviders,
    ...MIHOMO_QUERY_OPTIONS,
    revalidateOnMount: false,
  })

  const { data: rulesData } = useQuery({
    queryKey: APP_DATA_QUERY_KEYS.rules,
    queryFn: getRules,
    ...MIHOMO_QUERY_OPTIONS,
  })

  return {
    rules: rulesData?.rules ?? [],
    ruleProviders: (ruleProviders?.providers || {}) as Record<
      string,
      RuleProvider
    >,
  }
}
