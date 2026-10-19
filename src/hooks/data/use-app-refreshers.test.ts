import { describe, expect, it, vi } from 'vitest'

import { createAppRefreshers } from './use-app-refreshers'

describe('app-data refreshers', () => {
  it('revalidates every domain key through refreshAll', async () => {
    const revalidate = vi.fn((_key: readonly unknown[]) =>
      Promise.resolve(undefined),
    )
    const refreshers = createAppRefreshers(revalidate)

    await refreshers.refreshAll()

    expect(revalidate.mock.calls.map(([key]) => key[0])).toEqual([
      'getProxyView',
      'getClashConfig',
      'getRules',
      'getSystemProxy',
      'getRuleProviders',
    ])
  })

  it('revalidates a single domain key', async () => {
    const revalidate = vi.fn((_key: readonly unknown[]) =>
      Promise.resolve(undefined),
    )
    const refreshers = createAppRefreshers(revalidate)

    await refreshers.refreshProxy()

    expect(revalidate).toHaveBeenCalledExactlyOnceWith(['getProxyView'])
  })
})
