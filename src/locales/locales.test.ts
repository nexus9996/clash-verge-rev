import { describe, expect, it } from 'vitest'

const localeSources = import.meta.glob('./*/shared.json', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const locales = Object.fromEntries(
  Object.entries(localeSources).map(([file, source]) => [
    file,
    JSON.parse(source) as { statuses: Record<string, string> },
  ]),
)

describe('locale resources', () => {
  it('ships the not-found string in all 14 locales', () => {
    expect(Object.keys(locales)).toHaveLength(14)

    for (const [file, locale] of Object.entries(locales)) {
      expect(locale.statuses.pageNotFound, file).toBeTruthy()
    }
  })

  it('keeps statuses keys aligned with English', () => {
    const english = Object.keys(locales['./en/shared.json'].statuses).sort()

    for (const [file, locale] of Object.entries(locales)) {
      expect(Object.keys(locale.statuses).sort(), file).toEqual(english)
    }
  })
})
