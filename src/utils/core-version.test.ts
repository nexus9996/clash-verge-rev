import { expect, test } from 'vitest'

import { supportsTunDnsMode } from './core-version'

test('accepts the minimum core version that knows tun.dns-mode', () => {
  expect(supportsTunDnsMode('v1.19.33')).toBe(true)
  expect(
    supportsTunDnsMode('Mihomo Meta v1.19.33 darwin arm64 with go1.22.12'),
  ).toBe(true)
})

test('rejects cores older than tun.dns-mode support', () => {
  expect(supportsTunDnsMode('v1.19.32')).toBe(false)
  expect(supportsTunDnsMode('Mihomo Meta v1.18.9 darwin arm64')).toBe(false)
})

test('accepts newer cores', () => {
  expect(supportsTunDnsMode('v1.19.34')).toBe(true)
  expect(supportsTunDnsMode('v1.20.0')).toBe(true)
})

test('treats unknown or alpha build strings as current', () => {
  expect(supportsTunDnsMode(undefined)).toBe(true)
  expect(supportsTunDnsMode(null)).toBe(true)
  expect(supportsTunDnsMode('')).toBe(true)
  expect(supportsTunDnsMode('alpha-6780eee')).toBe(true)
})
