import { expect, test, vi } from 'vitest'

import { getIpInfo } from './api'
import { httpGetText } from './cmds'

vi.mock('@tauri-apps/api/app', () => ({
  getName: vi.fn().mockResolvedValue('clash-verge'),
  getVersion: vi.fn().mockResolvedValue('2.5.9'),
}))
vi.mock('./cmds', () => ({ httpGetText: vi.fn() }))
vi.mock('@/utils/debug', () => ({ debugLog: vi.fn() }))

test('IP probes use the shared backend HTTP stack and its timeout/User-Agent', async () => {
  vi.mocked(httpGetText).mockResolvedValue({
    status: 200,
    body: JSON.stringify({ ip: '203.0.113.1' }),
  })

  await getIpInfo()

  expect(httpGetText).toHaveBeenLastCalledWith(
    expect.any(String),
    5000,
    'clash-verge/2.5.9',
  )
})
