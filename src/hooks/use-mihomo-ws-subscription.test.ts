import { afterEach, expect, it, vi } from 'vitest'

import { createSharedSubscriptionEntry } from './use-mihomo-ws-subscription'

afterEach(() => {
  vi.useRealTimers()
})

it('closes the socket and schedules a reconnect when onConnected throws', async () => {
  vi.useFakeTimers()

  const close = vi.fn(async () => {})
  const ws = { addListener: vi.fn(), close }
  const connect = vi.fn(async () => ws as never)
  const entry = createSharedSubscriptionEntry(connect)
  const owner = {
    handleMessage: vi.fn(),
    isMounted: () => true,
    onConnected: vi.fn(() => {
      throw new Error('owner rejected the socket')
    }),
  }

  entry.owners.add(owner)
  entry.activeOwner = owner

  await entry.connectWs()

  expect(connect).toHaveBeenCalledOnce()
  expect(close).toHaveBeenCalledOnce()
  expect(entry.ws).toBeNull()

  await vi.advanceTimersByTimeAsync(1000)
  expect(connect).toHaveBeenCalledTimes(2)
})

it('does not close an adopted socket after a successful connect', async () => {
  const close = vi.fn(async () => {})
  const ws = { addListener: vi.fn(), close }
  const entry = createSharedSubscriptionEntry(async () => ws as never)
  const owner = {
    handleMessage: vi.fn(),
    isMounted: () => true,
    onConnected: vi.fn(),
  }

  entry.owners.add(owner)
  entry.activeOwner = owner

  await entry.connectWs()

  expect(ws.addListener).toHaveBeenCalledOnce()
  expect(entry.ws).toBe(ws)
  expect(close).not.toHaveBeenCalled()
})
