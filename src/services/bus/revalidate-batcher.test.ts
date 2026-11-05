import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { createRevalidateBatcher } from './revalidate-batcher'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

it('merges and deduplicates keys enqueued inside one window', () => {
  const revalidate = vi.fn()
  const batcher = createRevalidateBatcher(revalidate)

  batcher.enqueue(['getProxyView', 'getRules'])
  vi.advanceTimersByTime(50)
  batcher.enqueue(['getRules', 'getClashConfig'])

  // The second call joins the open window instead of restarting its timer.
  vi.advanceTimersByTime(69)
  expect(revalidate).not.toHaveBeenCalled()

  vi.advanceTimersByTime(1)
  expect(revalidate).toHaveBeenCalledExactlyOnceWith([
    'getProxyView',
    'getRules',
    'getClashConfig',
  ])

  batcher.dispose()
})

it('opens a fresh window after the previous batch flushes', () => {
  const revalidate = vi.fn()
  const batcher = createRevalidateBatcher(revalidate)

  batcher.enqueue(['getProxyView'])
  vi.advanceTimersByTime(120)
  expect(revalidate).toHaveBeenCalledExactlyOnceWith(['getProxyView'])

  batcher.enqueue(['getRules'])
  vi.advanceTimersByTime(120)
  expect(revalidate).toHaveBeenCalledTimes(2)
  expect(revalidate).toHaveBeenLastCalledWith(['getRules'])

  batcher.dispose()
})

it('drops the pending batch when the bus unmounts', () => {
  const revalidate = vi.fn()
  const batcher = createRevalidateBatcher(revalidate)

  batcher.enqueue(['getProxyView'])
  batcher.dispose()
  vi.advanceTimersByTime(500)

  expect(revalidate).not.toHaveBeenCalled()
})
