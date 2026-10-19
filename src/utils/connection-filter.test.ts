import { expect, test } from 'vitest'

import {
  createConnectionFilterMatcher,
  getConnectionFieldValues,
  type FilterableConnection,
} from './connection-filter'

type Overrides = Omit<Partial<FilterableConnection>, 'metadata'> & {
  metadata?: Partial<FilterableConnection['metadata']>
}

const connection = (overrides: Overrides = {}): FilterableConnection => {
  const { metadata, ...rest } = overrides
  return {
    metadata: {
      host: 'example.com',
      destinationIP: '1.2.3.4',
      destinationPort: '443',
      network: 'tcp',
      type: 'HTTPS',
      process: 'curl',
      processPath: '/usr/bin/curl',
      sourceIP: '10.0.0.2',
      sourcePort: '53124',
      remoteDestination: '1.2.3.4',
      ...metadata,
    },
    rule: 'Rule',
    rulePayload: 'example.com',
    chains: ['DIRECT', 'Proxy'],
    ...rest,
  }
}

test('matches every active field and ORs values within one field', () => {
  const first = connection()
  const second = connection({
    metadata: { host: 'other.org', destinationPort: '80' },
  })

  const matcher = createConnectionFilterMatcher([])
  expect(matcher(first)).toBe(true)

  const hostMatcher = createConnectionFilterMatcher([
    { field: 'host', value: 'other.org:80' },
  ])
  expect(hostMatcher(first)).toBe(false)
  expect(hostMatcher(second)).toBe(true)

  const networkMatcher = createConnectionFilterMatcher([
    { field: 'network', value: 'TCP' },
    { field: 'process', value: '/usr/bin/curl' },
  ])
  expect(networkMatcher(first)).toBe(true)

  const conflictingMatcher = createConnectionFilterMatcher([
    { field: 'network', value: 'tcp' },
    { field: 'type', value: 'HTTP' },
  ])
  expect(conflictingMatcher(first)).toBe(false)
})

test('derives the values offered for each field', () => {
  const value = connection({ chains: ['DIRECT', 'Proxy', 'Final'] })

  expect(getConnectionFieldValues('host', value)).toEqual(['example.com:443'])
  expect(getConnectionFieldValues('process', value)).toEqual([
    'curl',
    '/usr/bin/curl',
  ])
  expect(getConnectionFieldValues('rule', value)).toEqual(['Rule(example.com)'])
  expect(getConnectionFieldValues('chains', value)).toEqual([
    'Final / Proxy / DIRECT',
  ])
})

test('falls back to the destination IP when the host is empty', () => {
  const value = connection({ metadata: { host: '' } })
  expect(getConnectionFieldValues('host', value)).toEqual(['1.2.3.4:443'])
})
