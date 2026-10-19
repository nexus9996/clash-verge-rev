import { describe, expect, it } from 'vitest'

import { navigationItems } from '@/pages/_navigation-meta'

/**
 * Guards the single-source-of-truth contract between the sidebar navigation
 * catalog and the generated file-based route tree. If a route is added or
 * removed without updating the other side, this fails before the UI drifts.
 */
const generatedRouteTreeSources = import.meta.glob('../routeTree.gen.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const readGeneratedRoutePaths = () => {
  const [source] = Object.values(generatedRouteTreeSources)
  if (!source) throw new Error('generated route tree not found')

  return [...source.matchAll(/^\s*path: '([^']+)',$/gm)].map(
    (match) => match[1],
  )
}

describe('route catalog', () => {
  it('covers exactly the navigation paths', () => {
    const routePaths = new Set(readGeneratedRoutePaths())
    const navigationPaths = new Set(
      Object.values(navigationItems).map((item) => item.path),
    )

    expect([...routePaths].sort()).toEqual([...navigationPaths].sort())
  })

  it('keeps every navigation path unique', () => {
    const navigationPaths = Object.values(navigationItems).map(
      (item) => item.path,
    )

    expect(new Set(navigationPaths).size).toBe(navigationPaths.length)
  })
})
