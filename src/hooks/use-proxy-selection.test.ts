import { expect, it, vi } from 'vitest'

import { switchProxyNode } from '@/services/cmds'

import { useProxySelection } from './use-proxy-selection'

vi.mock('react', () => ({
  useCallback: (callback: unknown) => callback,
  useRef: (current: unknown) => ({ current }),
}))
vi.mock('@/services/cmds', () => ({ switchProxyNode: vi.fn() }))
vi.mock('@/services/notice-service', () => ({ showNotice: { error: vi.fn() } }))
vi.mock('@/services/query-client', () => ({ revalidateQueries: vi.fn() }))

it('requests independent group selections while another group is pending', async () => {
  let finishFirst!: () => void
  vi.mocked(switchProxyNode)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFirst = () => resolve(null)
        }),
    )
    .mockResolvedValueOnce(null)
  const first = useProxySelection()
  const second = useProxySelection()
  first.select('Group A', 'Node A')
  second.select('Group B', 'Node B', 'Node B')
  await vi.waitFor(() =>
    expect(switchProxyNode).toHaveBeenCalledWith('Group B', 'Node B', true),
  )
  expect(switchProxyNode).toHaveBeenCalledWith('Group A', 'Node A', false)
  expect(switchProxyNode).toHaveBeenCalledTimes(2)
  finishFirst()
})

it('executes every requested group once from a single hook instance', async () => {
  let finishFirst!: () => void
  vi.mocked(switchProxyNode)
    .mockReset()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFirst = () => resolve(null)
        }),
    )
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(null)
  const selection = useProxySelection()

  selection.select('Group A', 'Node A')
  selection.select('Group B', 'Node B')
  selection.select('Group C', 'Node C')

  await vi.waitFor(() => expect(switchProxyNode).toHaveBeenCalledTimes(1))
  finishFirst()
  await vi.waitFor(() => expect(switchProxyNode).toHaveBeenCalledTimes(3))

  expect(vi.mocked(switchProxyNode).mock.calls).toEqual([
    ['Group A', 'Node A', false],
    ['Group B', 'Node B', false],
    ['Group C', 'Node C', false],
  ])
})
