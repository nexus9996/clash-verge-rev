// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test, vi } from 'vitest'

import type { ProxyGroupView, ProxyViewV1 } from '@/types/proxy-view'

const { proxyView, delayManager } = vi.hoisted(() => {
  const node = (recordId: string, name: string) => ({
    recordId,
    name,
    type: 'Shadowsocks',
    history: [],
    udp: true,
    xudp: false,
    tfo: false,
    mptcp: false,
    smux: false,
    source: { kind: 'core' as const, proxyName: name },
  })
  const group = (
    name: string,
    type: string,
    members: ProxyGroupView['members'],
    now?: string,
  ) =>
    ({
      name,
      type,
      now,
      history: [],
      udp: true,
      xudp: false,
      tfo: false,
      mptcp: false,
      smux: false,
      members,
    }) as unknown as ProxyGroupView
  const nodeA = { kind: 'node' as const, name: 'node-a', recordId: 'c:0' }
  const nodeB = { kind: 'node' as const, name: 'node-b', recordId: 'c:1' }

  const proxyView = {
    schemaVersion: 1,
    orderSource: 'runtime',
    providerState: 'ready',
    global: group(
      'GLOBAL',
      'Selector',
      [{ kind: 'group' as const, name: 'Auto' }, nodeA, nodeB],
      'node-a',
    ),
    direct: 'c:direct',
    groups: [
      group('Auto', 'URLTest', [nodeA, nodeB]),
      group('Proxy', 'Selector', [nodeA], 'node-a'),
    ],
    records: {
      'c:0': node('c:0', 'node-a'),
      'c:1': node('c:1', 'node-b'),
      'c:direct': node('c:direct', 'DIRECT'),
    },
    standalone: ['c:direct'],
    providers: [],
  } as unknown as ProxyViewV1

  const delayManager = {
    getDelayFix: () => -1,
    getUrl: () => 'https://example.com',
    setUrl: () => {},
    checkListDelay: vi.fn(async () => []),
    isFresh: () => false,
  }
  return { proxyView, delayManager }
})

vi.mock('@/services/delay', () => ({ default: delayManager }))
vi.mock('@/hooks/data', () => ({
  useProxiesData: () => ({ proxyView }),
  useAppRefreshers: () => ({ refreshProxy: () => {} }),
}))
vi.mock('@/hooks/use-clash', () => ({
  useRuntimeConfig: () => ({ data: null }),
}))
vi.mock('@/hooks/use-group-delays', () => ({
  useGroupsDelays: () => new Map(),
}))
vi.mock('@/hooks/use-verge', () => ({
  useVerge: () => ({
    verge: { proxy_layout_column: 1, default_latency_timeout: 5000 },
  }),
}))
vi.mock('@/hooks/use-profiles', () => ({
  useProfiles: () => ({ profiles: { current: 'test' } }),
}))

const { useRenderList } = await import('./use-render-list')

const Probe = ({ mode }: { mode: string }) => {
  const { renderList } = useRenderList(mode, false, null)
  return (
    <div>
      {renderList.map((item) => (
        <div key={item.key} data-item={item.type} data-group={item.group.name}>
          {item.type === 0
            ? 'header'
            : `member:${item.member?.member.ref.name ?? ''}`}
        </div>
      ))}
    </div>
  )
}

const renderRows = (mode: string) => {
  const container = document.createElement('div')
  container.innerHTML = renderToStaticMarkup(<Probe mode={mode} />)
  return [...container.querySelectorAll<HTMLElement>('[data-item]')].map(
    (element) => ({
      type: Number(element.dataset.item),
      group: element.dataset.group,
      text: element.textContent,
    }),
  )
}

const headerNames = (mode: string) =>
  renderRows(mode)
    .filter(({ type }) => type === 0)
    .map(({ group }) => group)

test('global mode keeps GLOBAL selectable before the configured groups', () => {
  expect(headerNames('global')).toEqual(['GLOBAL', 'Auto', 'Proxy'])

  const global = renderRows('global').filter(({ group }) => group === 'GLOBAL')
  // A member row under GLOBAL is what selects the proxy global mode routes through.
  expect(global.some(({ type }) => type === 2)).toBe(true)
  expect(global.map(({ text }) => text)).toEqual(
    expect.arrayContaining(['member:node-a', 'member:node-b']),
  )
})

test('rule mode still renders only the configured groups', () => {
  expect(headerNames('rule')).toEqual(['Auto', 'Proxy'])
  expect(renderRows('rule').some(({ group }) => group === 'GLOBAL')).toBe(false)
})
