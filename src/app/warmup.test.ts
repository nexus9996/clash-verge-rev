import type { AnyRouter } from '@tanstack/react-router'
import { describe, expect, it, vi } from 'vitest'

import { NAV_ITEMS } from '@/config/navigation'

import { prefetchRouteChunks } from './warmup'

describe('prefetchRouteChunks', () => {
  it('preloads every navigation route and keeps going after a failure', async () => {
    const preloadRoute = vi.fn(async ({ to }: { to: string }) => {
      if (to === '/rules') throw new Error('preload failed')
      return []
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await prefetchRouteChunks({ preloadRoute } as unknown as AnyRouter)

    expect(preloadRoute).toHaveBeenCalledTimes(NAV_ITEMS.length)
    expect(preloadRoute.mock.calls.map(([options]) => options.to)).toEqual(
      NAV_ITEMS.map((item) => item.path),
    )
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})
