import { describe, expect, it } from 'vitest'

import { selectNewestPrerelease } from '../scripts/updater.mjs'

const release = (
  tag_name: string,
  overrides: Record<string, unknown> = {},
) => ({
  tag_name,
  prerelease: true,
  draft: false,
  ...overrides,
})

describe('selectNewestPrerelease', () => {
  it('picks the newest alpha by semver, not list order', () => {
    const selected = selectNewestPrerelease([
      release('v2.6.0-alpha.2'),
      release('v2.6.0-alpha.10'),
      release('v2.5.9-alpha.3'),
    ])

    expect(selected?.tag_name).toBe('v2.6.0-alpha.10')
  })

  it('prefers alpha releases over other prerelease channels', () => {
    const selected = selectNewestPrerelease([
      release('v2.6.0-rc.1'),
      release('v2.6.0-alpha.1'),
    ])

    expect(selected?.tag_name).toBe('v2.6.0-alpha.1')
  })

  it('falls back to the newest supported prerelease when no alpha exists', () => {
    const selected = selectNewestPrerelease([
      release('v2.6.0-beta.2'),
      release('v2.6.0-rc.1'),
      release('v2.5.9-beta.9'),
    ])

    expect(selected?.tag_name).toBe('v2.6.0-rc.1')
  })

  it('ignores stable tags, drafts and unsupported suffixes', () => {
    const selected = selectNewestPrerelease([
      release('v2.7.0', { prerelease: false }),
      release('v2.6.0-alpha.9', { draft: true }),
      release('v2.6.0-snapshot.4'),
      release('v2.6.0-alpha.1'),
    ])

    expect(selected?.tag_name).toBe('v2.6.0-alpha.1')
  })

  it('returns null when no publishable prerelease exists', () => {
    expect(selectNewestPrerelease([])).toBeNull()
    expect(
      selectNewestPrerelease([release('v2.7.0', { prerelease: false })]),
    ).toBeNull()
  })
})
