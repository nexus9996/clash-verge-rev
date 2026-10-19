export type RuleSearchMode = 'content' | 'domain' | 'cidr'

export interface RuleSearchState {
  mode: RuleSearchMode
  text: string
}

export const EMPTY_RULE_SEARCH: RuleSearchState = { mode: 'content', text: '' }

interface SearchableRule {
  type: string | { Unknown: string }
}

interface IpRange {
  version: 4 | 6
  start: bigint
  end: bigint
}

const DOMAIN_RULE_TYPES = new Set([
  'DOMAIN',
  'DOMAIN-SUFFIX',
  'DOMAIN-KEYWORD',
  'DOMAIN-REGEX',
  'DOMAIN-WILDCARD',
  'GEOSITE',
])

const CIDR_RULE_TYPES = new Set(['IP-CIDR', 'IP-CIDR6', 'SRC-IP-CIDR'])

const RULE_TYPE_ALIASES: Record<string, string> = {
  Domain: 'DOMAIN',
  DomainSuffix: 'DOMAIN-SUFFIX',
  DomainKeyword: 'DOMAIN-KEYWORD',
  DomainRegex: 'DOMAIN-REGEX',
  DomainWildcard: 'DOMAIN-WILDCARD',
  GeoSite: 'GEOSITE',
  IPCIDR: 'IP-CIDR',
  SrcIPCIDR: 'SRC-IP-CIDR',
}

const normalizeRuleType = (type: string | { Unknown: string }) => {
  const raw = typeof type === 'string' ? type : type.Unknown
  return RULE_TYPE_ALIASES[raw] ?? raw.toUpperCase()
}

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const createFuzzyMatcher = (query: string) => {
  const normalizedQuery = query.trim()
  if (!normalizedQuery) return () => true

  const matcher = new RegExp(escapeRegExp(normalizedQuery), 'i')
  return (value: string) => matcher.test(value)
}

export const normalizeDomain = (value: string) => {
  const trimmed = value.trim().toLowerCase()
  const rawHost = (() => {
    if (trimmed.includes('://')) {
      try {
        return new URL(trimmed).hostname
      } catch {
        // fall through to manual parsing
      }
    }
    const withoutScheme = trimmed.replace(/^[a-z][a-z\d+.-]*:\/\//, '')
    return withoutScheme.split(/[/?#]/)[0] ?? ''
  })()
  const withoutPort = rawHost.replace(/:\d+$/, '')

  return withoutPort
    .replace(/^\*\./, '')
    .replace(/^\+\./, '')
    .replace(/^\./, '')
    .replace(/\.$/, '')
}

const domainMatches = (
  rule: SearchableRule,
  payload: string,
  query: string,
) => {
  if (!query || !payload) return false

  const ruleType = normalizeRuleType(rule.type)
  if (!DOMAIN_RULE_TYPES.has(ruleType)) return false

  const value = normalizeDomain(payload)
  if (!value) return false

  if (ruleType === 'DOMAIN-KEYWORD') {
    return query.includes(value) || value.includes(query)
  }

  if (!query.includes('.')) return value.includes(query)
  if (ruleType === 'DOMAIN') return value === query

  return (
    value === query ||
    query.endsWith(`.${value}`) ||
    value.endsWith(`.${query}`)
  )
}

const parseIpv4 = (value: string) => {
  const parts = value.split('.')
  if (parts.length !== 4) return null

  return parts.reduce<bigint | null>((acc, part) => {
    if (acc === null || !/^\d+$/.test(part)) return null
    const byte = Number(part)
    if (byte < 0 || byte > 255) return null
    return (acc << BigInt(8)) + BigInt(byte)
  }, BigInt(0))
}

const parseIpv6 = (value: string) => {
  const scopedValue = value
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .split('%')[0]
  if (!scopedValue || scopedValue.split('::').length > 2) return null

  let normalizedValue = scopedValue
  if (normalizedValue.includes('.')) {
    const lastColonIndex = normalizedValue.lastIndexOf(':')
    const ipv4 = parseIpv4(normalizedValue.slice(lastColonIndex + 1))
    if (ipv4 === null) return null

    const high = Number((ipv4 >> BigInt(16)) & BigInt(0xffff)).toString(16)
    const low = Number(ipv4 & BigInt(0xffff)).toString(16)
    normalizedValue = `${normalizedValue.slice(0, lastColonIndex)}:${high}:${low}`
  }

  const [left = '', right = ''] = normalizedValue.split('::')
  const leftParts = left ? left.split(':') : []
  const rightParts = right ? right.split(':') : []
  const fillCount = 8 - leftParts.length - rightParts.length
  if (fillCount < 0 || (!normalizedValue.includes('::') && fillCount !== 0)) {
    return null
  }

  const parts = [
    ...leftParts,
    ...Array<string>(fillCount).fill('0'),
    ...rightParts,
  ]

  return parts.reduce<bigint | null>((acc, part) => {
    if (acc === null || !/^[\da-f]{1,4}$/.test(part)) return null
    return (acc << BigInt(16)) + BigInt(parseInt(part, 16))
  }, BigInt(0))
}

const parseIpValue = (value: string) => {
  if (value.includes(':')) {
    const parsed = parseIpv6(value)
    return parsed === null ? null : { version: 6 as const, value: parsed }
  }

  const parsed = parseIpv4(value)
  return parsed === null ? null : { version: 4 as const, value: parsed }
}

const parseCidrRange = (value: string): IpRange | null => {
  const parts = value.trim().split('/')
  if (parts.length > 2) return null
  const [address = '', prefixText] = parts
  const parsedIp = parseIpValue(address)
  if (!parsedIp) return null

  const bitSize = parsedIp.version === 4 ? 32 : 128
  if (prefixText !== undefined && !/^\d+$/.test(prefixText)) return null
  const prefix = prefixText === undefined ? bitSize : Number(prefixText)
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > bitSize) return null
  const hostBits = BigInt(bitSize - prefix)
  const blockSize = BigInt(1) << hostBits
  const start = (parsedIp.value >> hostBits) << hostBits

  return {
    version: parsedIp.version,
    start,
    end: start + blockSize - BigInt(1),
  }
}

const rangesOverlap = (left: IpRange, right: IpRange) =>
  left.version === right.version &&
  left.start <= right.end &&
  right.start <= left.end

const cidrMatches = (
  rule: SearchableRule,
  payload: string,
  normalizedQuery: string,
  queryRange: IpRange | null,
) => {
  if (!normalizedQuery || !payload) return false
  if (!CIDR_RULE_TYPES.has(normalizeRuleType(rule.type))) return false

  const payloadRange = parseCidrRange(payload)
  if (!queryRange || !payloadRange) {
    return payload.toLowerCase().includes(normalizedQuery)
  }

  return rangesOverlap(queryRange, payloadRange)
}

export const createRuleSearchMatcher =
  (search: RuleSearchState) =>
  (rule: SearchableRule, payload: string): boolean => {
    if (!search.text) return true

    if (search.mode === 'content') {
      return !!payload && createFuzzyMatcher(search.text)(payload)
    }

    if (search.mode === 'domain') {
      return domainMatches(rule, payload, normalizeDomain(search.text))
    }

    const normalizedQuery = search.text.trim().toLowerCase()
    return cidrMatches(
      rule,
      payload,
      normalizedQuery,
      parseCidrRange(normalizedQuery),
    )
  }
