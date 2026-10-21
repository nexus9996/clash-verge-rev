import { afterEach, expect, it, vi } from 'vitest'

import { createSharedSubscriptionEntry } from './use-mihomo-ws-subscription'

afterEach(() => {
  vi.useRealTimers()
})

it('keeps the socket when a one-shot owner prefill throws', async () => {
  vi.useFakeTimers()

  const close = vi.fn(async () => {})
  const ws = { addListener: vi.fn(), close }
  const connect = vi.fn(async () => ws as never)
  const entry = createSharedSubscriptionEntry(connect)
  const owner = {
    handleMessage: vi.fn(),
    isMounted: () => true,
    onConnected: vi.fn(() => {
      throw new Error('log history is temporarily unavailable')
    }),
  }

  entry.owners.add(owner)
  entry.activeOwner = owner

  await entry.connectWs()

  expect(connect).toHaveBeenCalledOnce()
  expect(close).not.toHaveBeenCalled()
  expect(ws.addListener).toHaveBeenCalledOnce()
  expect(entry.ws).toBe(ws)

  await vi.advanceTimersByTimeAsync(1000)
  expect(connect).toHaveBeenCalledOnce()
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
