import { describe, expect, it } from 'vitest'

import { NAV_ITEMS } from '@/config/navigation'

const routeSources = import.meta.glob('./*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const routeEntries = Object.entries(routeSources)
  .filter(([file]) => !file.endsWith('__root.tsx'))
  .map(([file, source]) => {
    const path = /createFileRoute\('([^']+)'\)/.exec(source)?.[1]
    const navId = /navId: '([^']+)'/.exec(source)?.[1]
    if (!path || !navId) throw new Error(`route metadata missing in ${file}`)

    return { path, navId }
  })

const sorted = (values: readonly string[]) => [...values].sort()

describe('route catalog', () => {
  it('covers exactly the navigation entries', () => {
    expect(sorted(routeEntries.map((entry) => entry.path))).toEqual(
      sorted(NAV_ITEMS.map((item) => item.path)),
    )
    expect(sorted(routeEntries.map((entry) => entry.navId))).toEqual(
      sorted(NAV_ITEMS.map((item) => item.id)),
    )
  })

  it('keeps every navigation path unique', () => {
    const paths = NAV_ITEMS.map((item) => item.path)

    expect(new Set(paths).size).toBe(paths.length)
  })
})
