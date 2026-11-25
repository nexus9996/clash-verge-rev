import * as yaml from 'js-yaml'

import type { TranslationKey } from '@/types/generated/i18n-keys'

export const builtinProxyPolicies = ['DIRECT', 'REJECT', 'REJECT-DROP', 'PASS']

export const PROXY_STRATEGY_LABEL_KEYS: Record<string, TranslationKey> = {
  select: 'proxies.components.enums.strategies.select',
  'url-test': 'proxies.components.enums.strategies.url-test',
  fallback: 'proxies.components.enums.strategies.fallback',
  'load-balance': 'proxies.components.enums.strategies.load-balance',
  relay: 'proxies.components.enums.strategies.relay',
}

export const PROXY_POLICY_LABEL_KEYS: Record<string, TranslationKey> =
  builtinProxyPolicies.reduce(
    (acc, policy) => {
      acc[policy] =
        `proxies.components.enums.policies.${policy}` as TranslationKey
      return acc
    },
    {} as Record<string, TranslationKey>,
  )

export const normalizeDeleteSeq = (input?: unknown): string[] => {
  if (!Array.isArray(input)) {
    return []
  }

  const names = input
    .map((item) => {
      if (typeof item === 'string') {
        return item
      }

      if (
        item &&
        typeof item === 'object' &&
        'name' in item &&
        typeof (item as { name: unknown }).name === 'string'
      ) {
        return (item as { name: string }).name
      }

      return undefined
    })
    .filter(
      (name): name is string => typeof name === 'string' && name.length > 0,
    )

  return Array.from(new Set(names))
}

export const buildGroupsYaml = (
  prepend: IProxyGroupConfig[],
  append: IProxyGroupConfig[],
  deleteList: string[],
) => {
  return yaml.dump(
    {
      prepend,
      append,
      delete: deleteList,
    },
    { forceQuotes: true },
  )
}

export const findRealIndex = (
  list: IProxyGroupConfig[],
  filtered: IProxyGroupConfig[],
  filteredIndex: number,
): number => {
  const item = filtered[filteredIndex]
  if (!item) return -1
  return list.findIndex((group) => group.name === item.name)
}
