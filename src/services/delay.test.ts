import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('tauri-plugin-mihomo-api', () => ({
  delayProxyByName: vi.fn(async () => ({ delay: 120 })),
  healthcheckNodeInProvider: vi.fn(async () => ({ delay: 120 })),
}))

import type { ResolvedProxyMember } from '@/types/proxy-view'
import { DEFAULT_LATENCY_TEST_URL } from '@/utils/delay'

import delayManager, { groupDelayKey } from './delay'

const node = (name: string) =>
  ({
    kind: 'node',
    ref: { kind: 'node', name, recordId: `r:${name}` },
    node: {
      recordId: `r:${name}`,
      name,
      history: [],
      source: { kind: 'core', proxyName: name },
    },
  }) as unknown as ResolvedProxyMember

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

let settles = 0
let unsubscribe: () => void

beforeEach(() => {
  settles = 0
  unsubscribe = delayManager.addGroupListener('g', () => {
    settles += 1
  })
})

afterEach(() => unsubscribe())

describe('group delay completion', () => {
  test('notifies once after a batch settles', async () => {
    const proxies = Array.from({ length: 6 }, (_, index) => node(`n${index}`))

    await delayManager.checkListDelay(proxies as never, 'g', 5000, 2)
    await flush()

    expect(settles).toBe(1)
    expect(delayManager.getDelayFix(proxies[0], 'g')).toBe(120)
  })

  test('notifies only listeners for the completed group', async () => {
    let other = 0
    const stop = delayManager.addGroupListener('other', () => {
      other += 1
    })

    await delayManager.checkDelay(node('a') as never, 'g', 5000)
    await flush()

    expect(settles).toBe(1)
    expect(other).toBe(0)
    expect(delayManager.getDelayFix(node('a'), 'g')).toBe(120)
    stop()
  })
})

test('unmeasured selectors show automatic history without replacing a cached result', () => {
  const member = node('selector-member')
  if (member.kind !== 'node') throw new Error('Expected node')
  member.node.history = [
    { time: new Date(Date.now() + 1000).toISOString(), delay: 126 },
  ]
  expect(delayManager.getDelayFix(member, 'selector')).toBe(126)
  delayManager.setDelay('selector-member', 'selector', 50)
  expect(delayManager.getDelayFix(member, 'selector')).toBe(50)
})

test('preserves a zero-millisecond delay from the node history', () => {
  const member = node('zero-delay')
  if (member.kind !== 'node') throw new Error('Expected node')
  member.node.history = [{ time: new Date().toISOString(), delay: 0 }]

  expect(delayManager.getDelayFix(member, 'zero')).toBe(0)
})

test('invalid latency URLs fall back to the shared default', () => {
  delayManager.setUrl('url-validation', 'ftp://localhost')
  expect(delayManager.getUrl('url-validation')).toBe(DEFAULT_LATENCY_TEST_URL)

  delayManager.setUrl('url-validation', 'http://localhost:8080/')
  expect(delayManager.getUrl('url-validation')).toBe('http://localhost:8080/')
})

test('group delay snapshots support group names containing spaces', () => {
  const groups = ['🇭🇰 Hong Kong', 'Auto Select']
  const snapshots = delayManager.groupsDelays(groupDelayKey(groups))

  expect([...snapshots.keys()]).toEqual(groups)
  expect(snapshots.get('🇭🇰 Hong Kong')).toBe(
    delayManager.groupDelays('🇭🇰 Hong Kong'),
  )
})
