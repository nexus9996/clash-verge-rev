// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, test, vi } from 'vitest'

import type { ProxyGroupView, ProxyViewV1 } from '@/types/proxy-view'

import type { HeadState } from './use-head-state'
import type { IRenderItem } from './use-render-list'

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const { proxyView, delayManager, hookState } = vi.hoisted(() => {
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
  return { proxyView, delayManager, hookState: { proxyView } }
})

vi.mock('@/services/delay', () => ({ default: delayManager }))
vi.mock('@/hooks/data', () => ({
  useProxiesData: () => ({ proxyView: hookState.proxyView }),
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

afterEach(() => {
  hookState.proxyView = proxyView
})

const { useRenderList } = await import('./use-render-list')

type Control = {
  onHeadState: (groupName: string, patch: Partial<HeadState>) => void
}

const Probe = ({
  mode,
  chain = false,
  selectedGroup = null,
  capture,
  onControl,
}: {
  mode: string
  chain?: boolean
  selectedGroup?: string | null
  capture?: (renderList: IRenderItem[]) => void
  onControl?: (control: Control) => void
}) => {
  const { renderList, onHeadState } = useRenderList(mode, chain, selectedGroup)
  capture?.(renderList)
  onControl?.({ onHeadState })
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

const flatHeaders = (mode: string) =>
  renderRows(mode)
    .filter(({ type }) => type === 1)
    .map(({ group }) => group)

test('global mode lists only GLOBAL members and the group it selects', () => {
  // GLOBAL selects a node, so no configured group is drawn beneath it.
  expect(headerNames('global')).toEqual([])
  expect(flatHeaders('global')).toEqual(['GLOBAL'])

  const rows = renderRows('global')
  // A member row under GLOBAL is what selects the proxy global mode routes through.
  expect(rows.every(({ group }) => group === 'GLOBAL')).toBe(true)
  expect(rows.some(({ type }) => type === 2)).toBe(true)
  expect(rows.map(({ text }) => text)).toEqual(
    expect.arrayContaining(['member:node-a', 'member:node-b']),
  )
})

test('global mode reveals the group GLOBAL selects below its rows', () => {
  const global = proxyView.global!
  const previousNow = global.now

  global.now = 'Auto'
  try {
    expect(flatHeaders('global')).toEqual(['GLOBAL'])
    expect(headerNames('global')).toEqual(['Auto'])
  } finally {
    global.now = previousNow
  }
})

test('global mode keeps DIRECT and REJECT listed as members', () => {
  const global = proxyView.global!
  const previousMembers = global.members
  const previousNow = global.now
  const directMember = {
    kind: 'node' as const,
    name: 'DIRECT',
    recordId: 'c:direct',
  }
  const rejectMember = {
    kind: 'node' as const,
    name: 'REJECT',
    recordId: 'c:reject',
  }

  proxyView.records['c:reject'] = {
    recordId: 'c:reject',
    name: 'REJECT',
    type: 'Reject',
    history: [],
    udp: false,
    xudp: false,
    tfo: false,
    mptcp: false,
    smux: false,
    source: { kind: 'core', proxyName: 'REJECT' },
  } as unknown as ProxyViewV1['records'][string]
  global.members = [...previousMembers, directMember, rejectMember]

  try {
    expect(renderRows('global').map(({ text }) => text)).toEqual(
      expect.arrayContaining(['member:node-a']),
    )
    const listedTexts = renderRows('global').map(({ text }) => text)
    expect(listedTexts).toEqual(
      expect.arrayContaining(['member:DIRECT', 'member:REJECT']),
    )
  } finally {
    global.members = previousMembers
    global.now = previousNow
    delete proxyView.records['c:reject']
  }
})

test('rule mode still renders only the configured groups', () => {
  expect(headerNames('rule')).toEqual(['Auto', 'Proxy'])
  expect(renderRows('rule').some(({ group }) => group === 'GLOBAL')).toBe(false)
})

const cloneView = () => JSON.parse(JSON.stringify(proxyView)) as ProxyViewV1

/** Mounts a probe whose hook instance survives rerenders, so its caches persist. */
const mountRerenderingProbe = async (
  mode: string,
  options?: { chain?: boolean; selectedGroup?: string | null },
) => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root: Root = createRoot(container)
  let latest: IRenderItem[] = []
  let control: Control | null = null

  const render = async () => {
    await act(async () => {
      root.render(
        <Probe
          mode={mode}
          chain={options?.chain}
          selectedGroup={options?.selectedGroup}
          capture={(renderList) => {
            latest = renderList
          }}
          onControl={(nextControl) => {
            control = nextControl
          }}
        />,
      )
    })
    return latest
  }

  const first = await render()

  return {
    first,
    setHeadState: async (groupName: string, patch: Partial<HeadState>) => {
      await act(async () => {
        control?.onHeadState(groupName, patch)
      })
      return latest
    },
    rerender: async (view: ProxyViewV1) => {
      hookState.proxyView = view
      return render()
    },
    unmount: async () => {
      await act(async () => {
        root.unmount()
      })
      container.remove()
    },
  }
}

const openGroups = async (
  probe: Awaited<ReturnType<typeof mountRerenderingProbe>>,
) => {
  await probe.setHeadState('Auto', { open: true })
  return probe.setHeadState('Proxy', { open: true })
}

test('refetching equal proxy content keeps the rendered items stable', async () => {
  const probe = await mountRerenderingProbe('rule')
  try {
    const first = await openGroups(probe)
    const refetched = await probe.rerender(cloneView())
    expect(refetched).toBe(first)
  } finally {
    await probe.unmount()
  }
})

test('selection changes rebuild only the affected group and reuse its members', async () => {
  const probe = await mountRerenderingProbe('rule')
  try {
    const first = await openGroups(probe)

    const nextView = cloneView()
    Object.assign(nextView.groups[0], { now: 'node-b' })
    const second = await probe.rerender(nextView)
    expect(second).not.toBe(first)

    // The untouched group keeps the exact same item objects.
    const proxyBefore = first.filter(({ group }) => group.name === 'Proxy')
    const proxyAfter = second.filter(({ group }) => group.name === 'Proxy')
    expect(proxyAfter).toHaveLength(proxyBefore.length)
    proxyAfter.forEach((item, index) => expect(item).toBe(proxyBefore[index]))

    // The affected group rebuilds its rows so the new selection is drawn...
    const autoBefore = first.filter(({ group }) => group.name === 'Auto')
    const autoAfter = second.filter(({ group }) => group.name === 'Auto')
    expect(autoAfter[0]).not.toBe(autoBefore[0])
    expect(autoAfter[0].group.now).toBe('node-b')

    // ...while its resolved members, whose content did not change, are reused.
    const memberBefore = autoBefore.find((item) => item.member)?.member?.member
    const memberAfter = autoAfter.find((item) => item.member)?.member?.member
    expect(memberAfter).toBe(memberBefore)
  } finally {
    await probe.unmount()
  }
})

test('changed member content re-resolves that member and refreshes its data', async () => {
  const probe = await mountRerenderingProbe('rule')
  try {
    const first = await openGroups(probe)

    const nextView = cloneView()
    Object.assign(nextView.records['c:1'], {
      history: [{ time: '2026-01-01T00:00:00Z', delay: 321 }],
    })
    const second = await probe.rerender(nextView)
    expect(second).not.toBe(first)

    // node-b is only listed under Auto, so Proxy must still be reused wholesale.
    const proxyBefore = first.filter(({ group }) => group.name === 'Proxy')
    const proxyAfter = second.filter(({ group }) => group.name === 'Proxy')
    proxyAfter.forEach((item, index) => expect(item).toBe(proxyBefore[index]))

    const autoBefore = first.filter(({ group }) => group.name === 'Auto')
    const autoAfter = second.filter(({ group }) => group.name === 'Auto')
    const findMember = (items: IRenderItem[], name: string) =>
      items.find((item) => item.member?.member.ref.name === name)?.member
        ?.member

    // node-a is untouched and keeps its resolved object.
    expect(findMember(autoAfter, 'node-a')).toBe(
      findMember(autoBefore, 'node-a'),
    )

    // node-b changed, so it is re-resolved with the fresh history.
    const nodeBAfter = findMember(autoAfter, 'node-b')
    expect(nodeBAfter).not.toBe(findMember(autoBefore, 'node-b'))
    expect(nodeBAfter?.kind).toBe('node')
    if (nodeBAfter?.kind === 'node') {
      expect(nodeBAfter.node.history.at(-1)?.delay).toBe(321)
    }
  } finally {
    await probe.unmount()
  }
})

test('search filtering still drives the rows and stays cached across refetches', async () => {
  const probe = await mountRerenderingProbe('rule')
  try {
    const opened = await openGroups(probe)
    const filtered = await probe.setHeadState('Auto', { filterText: 'node-b' })

    const autoRows = filtered.filter(
      (item) => item.group.name === 'Auto' && item.type === 2,
    )
    expect(autoRows.map((item) => item.member?.member.ref.name)).toEqual([
      'node-b',
    ])

    // The filtered group rebuilt for the new head state; Proxy was reused.
    const proxyOpened = opened.filter(({ group }) => group.name === 'Proxy')
    const proxyFiltered = filtered.filter(({ group }) => group.name === 'Proxy')
    proxyFiltered.forEach((item, index) =>
      expect(item).toBe(proxyOpened[index]),
    )

    const refetched = await probe.rerender(cloneView())
    expect(refetched).toBe(filtered)
  } finally {
    await probe.unmount()
  }
})

const CHAIN_OPTIONS = { chain: true, selectedGroup: 'Auto' }

const findChainRow = (items: IRenderItem[], name: string) =>
  items.find((item) => item.member?.member.ref.name === name)

test('refetching equal chain content keeps the chain list stable', async () => {
  const probe = await mountRerenderingProbe('rule', CHAIN_OPTIONS)
  try {
    const first = probe.first
    expect(first.map((item) => item.member?.member.ref.name)).toEqual([
      'node-a',
      'node-b',
    ])

    const refetched = await probe.rerender(cloneView())
    expect(refetched).toBe(first)
  } finally {
    await probe.unmount()
  }
})

test('chain refetch only rebuilds rows whose member content changed', async () => {
  const probe = await mountRerenderingProbe('rule', CHAIN_OPTIONS)
  try {
    const first = probe.first
    const nodeABefore = findChainRow(first, 'node-a')
    const nodeBBefore = findChainRow(first, 'node-b')

    const nextView = cloneView()
    Object.assign(nextView.records['c:1'], {
      history: [{ time: '2026-01-01T00:00:00Z', delay: 321 }],
    })
    const second = await probe.rerender(nextView)
    expect(second).not.toBe(first)

    // The unchanged node keeps its exact row object.
    expect(findChainRow(second, 'node-a')).toBe(nodeABefore)

    const nodeBAfter = findChainRow(second, 'node-b')
    expect(nodeBAfter).not.toBe(nodeBBefore)
    expect(nodeBAfter?.member?.member.kind).toBe('node')
    if (nodeBAfter?.member?.member.kind === 'node') {
      expect(nodeBAfter.member.member.node.history.at(-1)?.delay).toBe(321)
    }
  } finally {
    await probe.unmount()
  }
})

test('chain selection changes rebuild rows but reuse resolved members', async () => {
  const probe = await mountRerenderingProbe('rule', CHAIN_OPTIONS)
  try {
    const first = probe.first
    const nodeABefore = findChainRow(first, 'node-a')
    const memberBefore = nodeABefore?.member?.member

    const nextView = cloneView()
    Object.assign(nextView.groups[0], { now: 'node-b' })
    const second = await probe.rerender(nextView)
    expect(second).not.toBe(first)

    const nodeAAfter = findChainRow(second, 'node-a')
    // Selection is drawn from the embedded group, so rows rebuild with it...
    expect(nodeAAfter).not.toBe(nodeABefore)
    expect(nodeAAfter?.group.now).toBe('node-b')
    // ...while the resolved members stay identical.
    expect(nodeAAfter?.member?.member).toBe(memberBefore)
  } finally {
    await probe.unmount()
  }
})
