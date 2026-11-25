import { afterEach, expect, test, vi } from 'vitest'

import { createLatestSaver } from './guard-state-saver'

// Let queued promise callbacks settle without advancing real time.
const settle = async () => {
  await vi.advanceTimersByTimeAsync(0)
}

afterEach(() => {
  vi.useRealTimers()
})

test('debounces saves and only persists the latest value', async () => {
  vi.useFakeTimers()
  const onSave = vi.fn().mockResolvedValue(undefined)
  const saver = createLatestSaver<number>({
    waitTime: 300,
    initialCommitted: 0,
    onSave,
    onRollback: vi.fn(),
  })

  saver.change(1)
  saver.change(2)
  saver.change(3)

  expect(onSave).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(299)
  expect(onSave).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  expect(onSave).toHaveBeenCalledTimes(1)
  expect(onSave).toHaveBeenCalledWith(3, 0)
})

test('saves each change immediately when there is no wait time', async () => {
  vi.useFakeTimers()
  const onSave = vi.fn().mockResolvedValue(undefined)
  const saver = createLatestSaver<number>({
    initialCommitted: 0,
    onSave,
    onRollback: vi.fn(),
  })

  saver.change(1)
  await settle()
  saver.change(2)
  await settle()

  expect(onSave).toHaveBeenNthCalledWith(1, 1, 0)
  expect(onSave).toHaveBeenNthCalledWith(2, 2, 1)
})

test('never rolls back on a stale failure while a newer change is pending', async () => {
  vi.useFakeTimers()
  const first = { reject: (_error: Error) => {} }
  const firstSave = new Promise<void>((_resolve, reject) => {
    first.reject = reject
  })
  const onSave = vi
    .fn()
    .mockImplementationOnce(() => firstSave)
    .mockResolvedValue(undefined)
  const onRollback = vi.fn()
  const onCatch = vi.fn()
  const saver = createLatestSaver<number>({
    initialCommitted: 0,
    onSave,
    onRollback,
    onCatch,
  })

  saver.change(1)
  expect(onSave).toHaveBeenCalledWith(1, 0)
  saver.change(2)

  first.reject(new Error('stale'))
  await settle()

  expect(onRollback).not.toHaveBeenCalled()
  expect(onCatch).not.toHaveBeenCalled()
  expect(onSave).toHaveBeenLastCalledWith(2, 0)
})

test('rolls back to the last persisted value when the latest save fails', async () => {
  vi.useFakeTimers()
  const onSave = vi
    .fn()
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error('latest'))
  const onRollback = vi.fn()
  const onCatch = vi.fn()
  const saver = createLatestSaver<number>({
    initialCommitted: 0,
    onSave,
    onRollback,
    onCatch,
  })

  saver.change(1)
  await settle()
  saver.change(2)
  await settle()

  expect(onSave).toHaveBeenLastCalledWith(2, 1)
  expect(onRollback).toHaveBeenCalledWith(1)
  expect(onCatch).toHaveBeenCalledTimes(1)
})

test('flush applies the pending value without waiting for the timer', () => {
  vi.useFakeTimers()
  const onSave = vi.fn().mockResolvedValue(undefined)
  const saver = createLatestSaver<number>({
    waitTime: 300,
    initialCommitted: 0,
    onSave,
    onRollback: vi.fn(),
  })

  saver.change(7)
  saver.flush()
  expect(onSave).toHaveBeenCalledWith(7, 0)
})

test('dispose drops a pending debounced save', async () => {
  vi.useFakeTimers()
  const onSave = vi.fn().mockResolvedValue(undefined)
  const saver = createLatestSaver<number>({
    waitTime: 300,
    initialCommitted: 0,
    onSave,
    onRollback: vi.fn(),
  })

  saver.change(1)
  saver.dispose()
  await vi.advanceTimersByTimeAsync(300)
  expect(onSave).not.toHaveBeenCalled()
})
