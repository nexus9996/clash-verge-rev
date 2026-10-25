import { expect, test } from 'vitest'

import {
  buildTunConfig,
  defaultTunFormValues,
  splitRouteExcludeAddress,
} from './tun-config'

test('reset defaults describe the same TUN payload the dialog writes', () => {
  const values = defaultTunFormValues('macos')

  expect(values.dnsMode).toBe('')
  expect(buildTunConfig(values, 'macos')).toMatchObject({
    stack: 'mips',
    device: 'utun1024',
    'auto-route': true,
    'auto-detect-interface': true,
    'dns-hijack': ['any:53'],
    'dns-mode': '',
    'strict-route': false,
    mtu: 1500,
  })
})

test('a saved dns mode reaches the wire payload', () => {
  const values = {
    ...defaultTunFormValues('windows'),
    dnsMode: 'hijack',
    mtu: 1400,
  }
  const tun = buildTunConfig(values, 'windows')

  expect(tun['dns-mode']).toBe('hijack')
  expect(tun.mtu).toBe(1400)
})

test('linux-only fields stay off other platforms', () => {
  const values = { ...defaultTunFormValues('linux'), autoRedirect: true }

  expect(buildTunConfig(values, 'linux')['auto-redirect']).toBe(true)
  expect(buildTunConfig(values, 'macos')).not.toHaveProperty('auto-redirect')
})

test('an empty device falls back to the platform default', () => {
  const values = { ...defaultTunFormValues('linux'), device: '' }

  expect(buildTunConfig(values, 'linux').device).toBe('Mihomo')
  expect(buildTunConfig(values, 'macos').device).toBe('utun1024')
})

test('an empty dns hijack entry clears the hijack list', () => {
  const values = { ...defaultTunFormValues('macos'), dnsHijack: [''] }

  expect(buildTunConfig(values, 'macos')['dns-hijack']).toEqual([])
})

test('route exclude addresses are normalised before they are written', () => {
  expect(splitRouteExcludeAddress('192.168.0.0/16, 10.0.0.0/8\n::1')).toEqual([
    '192.168.0.0/16',
    '10.0.0.0/8',
    '::1',
  ])
})
