import { compareVersions as compareSemver } from 'compare-versions'

import { checkUpdateAvailable, type UpdateInfo } from '@/services/cmds'
import { version as appVersion } from '@root/package.json'

const SEMVER_FULL_REGEX =
  /^\d+(?:\.\d+){1,2}(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const SEMVER_SEARCH_REGEX =
  /v?\d+(?:\.\d+){1,2}(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?/i

const normalizeVersion = (input: string | null | undefined): string | null => {
  if (typeof input !== 'string') return null
  const trimmed = input.trim()
  if (!trimmed) return null
  return trimmed.replace(/^v/i, '')
}

const ensureSemver = (input: string | null | undefined): string | null => {
  const normalized = normalizeVersion(input)
  if (!normalized) return null
  return SEMVER_FULL_REGEX.test(normalized) ? normalized : null
}

const extractSemver = (input: string | null | undefined): string | null => {
  if (typeof input !== 'string') return null
  const match = input.match(SEMVER_SEARCH_REGEX)
  if (!match) return null
  return normalizeVersion(match[0])
}

const compareVersions = (a: string | null, b: string | null): number | null => {
  if (!a || !b) return null
  try {
    return compareSemver(a, b)
  } catch {
    return null
  }
}

export type Update = UpdateInfo & { available: true }

const resolveRemoteVersion = (update: UpdateInfo): string | null => {
  const primary = ensureSemver(update.version)
  if (primary) return primary

  const fallbackPrimary = extractSemver(update.version)
  if (fallbackPrimary) return fallbackPrimary

  const raw =
    typeof update.rawJson === 'object' &&
    update.rawJson !== null &&
    !Array.isArray(update.rawJson)
      ? update.rawJson
      : {}
  const rawVersion = ensureSemver(
    typeof raw.version === 'string' ? raw.version : null,
  )
  if (rawVersion) return rawVersion

  const tagVersion = extractSemver(
    typeof raw.tag_name === 'string' ? raw.tag_name : null,
  )
  if (tagVersion) return tagVersion

  const nameVersion = extractSemver(
    typeof raw.name === 'string' ? raw.name : null,
  )
  if (nameVersion) return nameVersion

  return null
}

const localVersionNormalized = normalizeVersion(appVersion)

export const checkUpdateSafe = async (): Promise<Update | null> => {
  const result = await checkUpdateAvailable()
  if (!result) return null

  const update: Update = { ...result, available: true }
  const remoteVersion = resolveRemoteVersion(update)
  const comparison = compareVersions(remoteVersion, localVersionNormalized)

  const isBuildToStable =
    /^\d+\.\d+\.\d+\+[0-9A-Za-z.-]+$/.test(localVersionNormalized ?? '') &&
    remoteVersion === localVersionNormalized?.split('+')[0]

  if (comparison !== null && comparison <= 0 && !isBuildToStable) {
    return null
  }

  return update
}
