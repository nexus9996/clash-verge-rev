import { afterEach, expect, it, vi } from 'vitest'

import { createPollingGroup } from './proxy-view-polling'

afterEach(() => {
  vi.useRealTimers()
})

it('shares one timer between consumers and stops it after the last release', async () => {
  vi.useFakeTimers()
  const revalidate = vi.fn()
  const poller = createPollingGroup(revalidate)

  const releaseFirst = poller.subscribe(15000)
  const releaseSecond = poller.subscribe(15000)
  expect(vi.getTimerCount()).toBe(1)

  await vi.advanceTimersByTimeAsync(15000)
  expect(revalidate).toHaveBeenCalledOnce()

  releaseFirst()
  expect(vi.getTimerCount()).toBe(1)
  releaseSecond()
  expect(vi.getTimerCount()).toBe(0)
})

it('polls at the shortest interval requested by any consumer', async () => {
  vi.useFakeTimers()
  const revalidate = vi.fn()
  const poller = createPollingGroup(revalidate)

  const releaseSlow = poller.subscribe(60000)
  const releaseFast = poller.subscribe(15000)
  await vi.advanceTimersByTimeAsync(15000)
  expect(revalidate).toHaveBeenCalledOnce()

  releaseFast()
  await vi.advanceTimersByTimeAsync(15000)
  expect(revalidate).toHaveBeenCalledOnce()
  releaseSlow()
})
