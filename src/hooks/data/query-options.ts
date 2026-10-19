/**
 * Cache keys and fetch policies shared by the app-data domain hooks.
 * Keys are string arrays because the query-client normalizes them for SWR and
 * the intent funnel revalidates by the same references.
 */
export const APP_DATA_QUERY_KEYS = {
  proxyView: ['getProxyView'],
  clashConfig: ['getClashConfig'],
  ruleProviders: ['getRuleProviders'],
  rules: ['getRules'],
  sysproxy: ['getSystemProxy'],
} as const

export const MIHOMO_QUERY_OPTIONS = {
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  staleTime: 1500,
  retry: 3,
  retryDelay: (attempt: number) => Math.min(200 * 2 ** attempt, 3000),
} as const

export const DEFAULT_QUERY_OPTIONS = {
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  staleTime: 5000,
  retry: 2,
} as const
