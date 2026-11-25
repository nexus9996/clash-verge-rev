import { compareVersions } from 'compare-versions'

/** `tun.dns-mode` was introduced in mihomo v1.19.33. */
const TUN_DNS_MODE_MIN_CORE_VERSION = '1.19.33'

const SEMVER_PATTERN = /(\d+)\.(\d+)\.(\d+)/

/**
 * Extracts a comparable semver from the core version reported by the mihomo
 * API, which may carry a `v` prefix or a build suffix.
 */
const parseCoreSemver = (rawVersion?: string | null): string | null => {
  if (!rawVersion) return null
  const match = rawVersion.match(SEMVER_PATTERN)
  if (!match) return null
  return `${match[1]}.${match[2]}.${match[3]}`
}

/**
 * Older cores silently ignore `tun.dns-mode`, so the TUN dialog only offers the
 * control when the running core is known to support it. Unparsable build strings
 * (alpha hashes, no core running) are treated as current instead of hiding a
 * supported feature.
 */
export const supportsTunDnsMode = (rawVersion?: string | null): boolean => {
  const semver = parseCoreSemver(rawVersion)
  if (!semver) return true
  return compareVersions(semver, TUN_DNS_MODE_MIN_CORE_VERSION) >= 0
}
