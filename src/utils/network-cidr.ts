import { ipv4, ipv6 } from 'cidr-block'
import isIP from 'validator/es/lib/isIP'

import { normalizeHost } from './network'

const stripBrackets = (value: string) =>
  value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value

const isIpv4 = (value: string) => isIP(value, 4)
const isIpv6 = (value: string) => isIP(value, 6)

/**
 * IP/CIDR helpers live in a separate module from `network.ts`: `cidr-block`
 * is only needed by the settings/tunnel viewers, so keeping it out of the
 * shared helpers keeps it off the initial bundle.
 */
export const normalizeListenHost = (value: string): string | null => {
  const host = normalizeHost(value)
  if (!host || host === 'localhost') {
    return host
  }

  if (isIpv4(host)) {
    const address = ipv4.address(host)
    return address.equals('0.0.0.0') ||
      address.isLoopbackAddress() ||
      address.isPrivateAddress()
      ? host
      : null
  }

  if (!isIpv6(host)) {
    return null
  }

  const address = ipv6.address(host)
  return address.isUnspecifiedAddress() ||
    address.isLoopbackAddress() ||
    address.isUniqueLocalAddress() ||
    address.isLinkLocalAddress()
    ? host
    : null
}

export const isValidIpCidr = (value: string): boolean => {
  const cidr = value.trim()
  const slashIndex = cidr.lastIndexOf('/')
  if (slashIndex <= 0) {
    return false
  }

  const address = stripBrackets(cidr.slice(0, slashIndex))
  return (
    (isIpv4(address) && ipv4.isValidCIDR(cidr)) ||
    (isIpv6(address) && ipv6.isValidCIDR(cidr))
  )
}

export const areValidIpCidrs = (values: string[]) => values.every(isValidIpCidr)
