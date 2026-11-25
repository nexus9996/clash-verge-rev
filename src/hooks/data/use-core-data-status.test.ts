import { beforeEach, expect, it, vi } from 'vitest'

vi.mock('./use-proxy-view-data', () => ({
  useProxiesData: vi.fn(() => ({ isProxyViewPending: true })),
}))
vi.mock('./use-clash-config-data', () => ({
  useClashConfigData: vi.fn(() => ({ isClashConfigPending: false })),
}))

import { useCoreDataStatus } from './use-core-data-status'
import { useProxiesData } from './use-proxy-view-data'

beforeEach(() => {
  vi.clearAllMocks()
})

it('does not poll the proxy view when only a pending flag is needed', () => {
  expect(useCoreDataStatus().isCoreDataPending).toBe(true)
  expect(useProxiesData).toHaveBeenCalledExactlyOnceWith(false)
})

it('forwards an explicit polling interval to the proxy view query', () => {
  useCoreDataStatus(60000)
  expect(useProxiesData).toHaveBeenCalledExactlyOnceWith(60000)
})
