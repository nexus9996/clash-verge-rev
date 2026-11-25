import isFQDN from 'validator/es/lib/isFQDN'
import isIP from 'validator/es/lib/isIP'
import isPort from 'validator/es/lib/isPort'
import isURL from 'validator/es/lib/isURL'

/**
 * Shared host/URL helpers used by the initial bundle. IP/CIDR helpers that
 * depend on `cidr-block` live in `network-cidr.ts` so the CIDR library stays
 * out of the first screen.
 */
export const isValidUrl = (value: string) =>
  isURL(value.trim(), {
    protocols: ['http', 'https'],
    require_protocol: true,
    require_valid_protocol: true,
    require_host: true,
    require_tld: false,
  })

export const isValidPort = (value: string) => isPort(value.trim())

export const normalizeHost = (value: string): string | null => {
  const host = value.trim()
  if (!host) {
    return null
  }

  if (host.toLowerCase() === 'localhost') {
    return 'localhost'
  }

  const normalizedHost =
    host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
  if (isIP(normalizedHost, 4) || isIP(normalizedHost, 6)) {
    return normalizedHost
  }

  return isFQDN(host, { require_tld: false }) ? host : null
}

export const formatHostPort = (host: string, port: string | number) =>
  isIP(host, 6) ? `[${host}]:${port}` : `${host}:${port}`
