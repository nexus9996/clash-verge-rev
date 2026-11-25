import * as yaml from 'js-yaml'

export type NameserverPolicy = Record<string, any>

function parseNameserverPolicy(str: string): NameserverPolicy {
  const result: NameserverPolicy = {}
  if (!str) return result

  const ruleRegex = /\s*([^=]+?)\s*=\s*([^,]+)(?:,|$)/g
  const matches = [...str.matchAll(ruleRegex)]

  matches.forEach((match) => {
    const [, domainsPart, serversPart] = match

    const domains = [domainsPart.trim()]
    const servers = serversPart.split(';').map((s) => s.trim())

    domains.forEach((domain) => {
      result[domain] = servers
    })
  })

  return result
}

export function formatNameserverPolicy(policy: unknown): string {
  if (!policy || typeof policy !== 'object') return ''

  return Object.entries(policy as Record<string, unknown>)
    .map(([domain, servers]) => {
      const serversStr = Array.isArray(servers) ? servers.join(';') : servers
      return `${domain}=${serversStr}`
    })
    .join(', ')
}

export function formatHosts(hosts: unknown): string {
  if (!hosts || typeof hosts !== 'object') return ''

  const result: string[] = []

  Object.entries(hosts as Record<string, unknown>).forEach(
    ([domain, value]) => {
      if (Array.isArray(value)) {
        const ipsStr = value.join(';')
        result.push(`${domain}=${ipsStr}`)
      } else {
        result.push(`${domain}=${value}`)
      }
    },
  )

  return result.join(', ')
}

export function parseHosts(str: string): NameserverPolicy {
  const result: NameserverPolicy = {}
  if (!str) return result

  str.split(',').forEach((item) => {
    const parts = item.trim().split('=')
    if (parts.length < 2) return

    const domain = parts[0].trim()
    const valueStr = parts.slice(1).join('=').trim()

    if (valueStr.includes(';')) {
      result[domain] = valueStr
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean)
    } else {
      result[domain] = valueStr
    }
  })

  return result
}

function parseList(str: string): string[] {
  if (!str?.trim()) return []
  return str
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

export const DEFAULT_DNS_CONFIG = {
  enable: true,
  listen: ':53',
  'enhanced-mode': 'fake-ip' as 'fake-ip' | 'redir-host',
  'fake-ip-range': '198.18.0.1/16',
  'fake-ip-range6': 'fdfe:dcba:9876::1/64',
  'fake-ip-filter-mode': 'blacklist' as 'blacklist' | 'whitelist',
  'prefer-h3': false,
  'respect-rules': false,
  'use-hosts': false,
  'use-system-hosts': false,
  ipv6: true,
  'fake-ip-filter': [
    '*.lan',
    '*.local',
    '*.arpa',
    'time.*.com',
    'ntp.*.com',
    'time.*.com',
    '+.market.xiaomi.com',
    'localhost.ptlogin2.qq.com',
    '*.msftncsi.com',
    'www.msftconnecttest.com',
  ],
  'default-nameserver': [
    'system',
    '223.6.6.6',
    '8.8.8.8',
    '2400:3200::1',
    '2001:4860:4860::8888',
  ],
  nameserver: [
    '8.8.8.8',
    'https://doh.pub/dns-query',
    'https://dns.alidns.com/dns-query',
  ],
  fallback: [],
  'nameserver-policy': {},
  'proxy-server-nameserver': [],
  'direct-nameserver': [],
  'direct-nameserver-follow-policy': false,
  'fallback-filter': {
    geoip: true,
    'geoip-code': 'CN',
    ipcidr: ['240.0.0.0/4', '0.0.0.0/32'],
    domain: ['+.google.com', '+.facebook.com', '+.youtube.com'],
  },
}

export type DnsFormValues = {
  enable: boolean
  listen: string
  enhancedMode: 'fake-ip' | 'redir-host'
  fakeIpRange: string
  fakeIpRange6: string
  fakeIpFilterMode: 'blacklist' | 'whitelist'
  preferH3: boolean
  respectRules: boolean
  useHosts: boolean
  useSystemHosts: boolean
  ipv6: boolean
  fakeIpFilter: string
  nameserver: string
  fallback: string
  defaultNameserver: string
  proxyServerNameserver: string
  directNameserver: string
  directNameserverFollowPolicy: boolean
  fallbackGeoip: boolean
  fallbackGeoipCode: string
  fallbackIpcidr: string
  fallbackDomain: string
  nameserverPolicy: string
  hosts: string // hosts设置，独立于dns
}

export const DEFAULT_FORM_VALUES: DnsFormValues = {
  enable: DEFAULT_DNS_CONFIG.enable,
  listen: DEFAULT_DNS_CONFIG.listen,
  enhancedMode: DEFAULT_DNS_CONFIG['enhanced-mode'],
  fakeIpRange: DEFAULT_DNS_CONFIG['fake-ip-range'],
  fakeIpRange6: DEFAULT_DNS_CONFIG['fake-ip-range6'],
  fakeIpFilterMode: DEFAULT_DNS_CONFIG['fake-ip-filter-mode'],
  preferH3: DEFAULT_DNS_CONFIG['prefer-h3'],
  respectRules: DEFAULT_DNS_CONFIG['respect-rules'],
  useHosts: DEFAULT_DNS_CONFIG['use-hosts'],
  useSystemHosts: DEFAULT_DNS_CONFIG['use-system-hosts'],
  ipv6: DEFAULT_DNS_CONFIG.ipv6,
  fakeIpFilter: DEFAULT_DNS_CONFIG['fake-ip-filter'].join(', '),
  defaultNameserver: DEFAULT_DNS_CONFIG['default-nameserver'].join(', '),
  nameserver: DEFAULT_DNS_CONFIG.nameserver.join(', '),
  fallback: DEFAULT_DNS_CONFIG.fallback.join(', '),
  proxyServerNameserver:
    DEFAULT_DNS_CONFIG['proxy-server-nameserver']?.join(', ') || '',
  directNameserver: DEFAULT_DNS_CONFIG['direct-nameserver']?.join(', ') || '',
  directNameserverFollowPolicy:
    DEFAULT_DNS_CONFIG['direct-nameserver-follow-policy'] || false,
  fallbackGeoip: DEFAULT_DNS_CONFIG['fallback-filter'].geoip,
  fallbackGeoipCode: DEFAULT_DNS_CONFIG['fallback-filter']['geoip-code'],
  fallbackIpcidr:
    DEFAULT_DNS_CONFIG['fallback-filter'].ipcidr?.join(', ') || '',
  fallbackDomain:
    DEFAULT_DNS_CONFIG['fallback-filter'].domain?.join(', ') || '',
  nameserverPolicy: '',
  hosts: '',
}

export function buildDnsConfig(values: DnsFormValues) {
  const dnsConfig: any = {
    enable: values.enable,
    listen: values.listen,
    'enhanced-mode': values.enhancedMode,
    'fake-ip-range': values.fakeIpRange,
    'fake-ip-range6': values.fakeIpRange6,
    'fake-ip-filter-mode': values.fakeIpFilterMode,
    'prefer-h3': values.preferH3,
    'respect-rules': values.respectRules,
    'use-hosts': values.useHosts,
    'use-system-hosts': values.useSystemHosts,
    ipv6: values.ipv6,
    'fake-ip-filter': parseList(values.fakeIpFilter),
    'default-nameserver': parseList(values.defaultNameserver),
    nameserver: parseList(values.nameserver),
    'nameserver-policy': parseNameserverPolicy(values.nameserverPolicy),
    'direct-nameserver-follow-policy': values.directNameserverFollowPolicy,
    'fallback-filter': {
      geoip: values.fallbackGeoip,
      'geoip-code': values.fallbackGeoipCode,
      ipcidr: parseList(values.fallbackIpcidr),
      domain: parseList(values.fallbackDomain),
    },

    fallback: parseList(values.fallback),
    'proxy-server-nameserver': parseList(values.proxyServerNameserver),
    'direct-nameserver': parseList(values.directNameserver),
  }

  return dnsConfig
}

export function buildDnsYaml(values: DnsFormValues) {
  const config: Record<string, any> = {}

  const dnsConfig = buildDnsConfig(values)
  if (Object.keys(dnsConfig).length > 0) {
    config.dns = dnsConfig
  }

  config.hosts = parseHosts(values.hosts)

  return yaml.dump(config, { forceQuotes: true })
}
