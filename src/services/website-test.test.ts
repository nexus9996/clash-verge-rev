import { expect, test, vi } from 'vitest'

vi.mock('./cmds', () => ({ cmdTestDelay: vi.fn() }))

import { cmdTestDelay } from './cmds'
import { testWebsiteDelayQueued } from './website-test'

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

test('caps concurrent website probes and keeps the rest queued', async () => {
  const releases: Array<() => void> = []
  let active = 0
  let started = 0
  let maxActive = 0
  vi.mocked(cmdTestDelay).mockImplementation(async () => {
    active += 1
    started += 1
    maxActive = Math.max(maxActive, active)
    await new Promise<void>((resolve) => releases.push(resolve))
    active -= 1
    return 42
  })

  const runs = Array.from({ length: 5 }, (_, index) =>
    testWebsiteDelayQueued(`http://localhost/${index}`),
  )
  await flush()
  expect(started).toBe(3)

  while (started < runs.length) {
    releases.shift()?.()
    await flush()
  }
  while (releases.length > 0) releases.shift()?.()

  await expect(Promise.all(runs)).resolves.toEqual([42, 42, 42, 42, 42])
  expect(maxActive).toBe(3)
})
