import { selectNodeForGroup } from 'tauri-plugin-mihomo-api'
import { expect, it, vi } from 'vitest'

import { useProxySelection } from './use-proxy-selection'

const record = vi.hoisted(() => vi.fn())
vi.mock('react', () => ({
  useCallback: (callback: unknown) => callback,
  useRef: (current: unknown) => ({ current }),
}))
vi.mock('@/hooks/use-record-selection', () => ({
  useRecordSelection: () => record,
  useForgetSelection: () => vi.fn(),
}))
vi.mock('@/hooks/use-verge', () => ({ useVerge: () => ({ verge: {} }) }))
vi.mock('tauri-plugin-mihomo-api', () => ({
  selectNodeForGroup: vi.fn(),
  unfixedProxy: vi.fn(),
}))
vi.mock('@/services/cmds', () => ({ syncTrayProxySelection: vi.fn() }))
vi.mock('@/services/notice-service', () => ({ showNotice: { error: vi.fn() } }))
vi.mock('@/services/query-client', () => ({ revalidateQueries: vi.fn() }))

it('applies and records independent group selections while another group is pending', async () => {
  let finishFirst!: () => void
  vi.mocked(selectNodeForGroup)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFirst = resolve
        }),
    )
    .mockResolvedValueOnce(undefined)
  const firstSuccess = vi.fn()
  const secondSuccess = vi.fn()
  const first = useProxySelection({ onSuccess: firstSuccess })
  const second = useProxySelection({ onSuccess: secondSuccess })
  first.changeProxy('Group A', 'Node A')
  second.changeProxy('Group B', 'Node B')
  await vi.waitFor(() =>
    expect(record).toHaveBeenCalledWith('Group B', 'Node B'),
  )
  expect(selectNodeForGroup).toHaveBeenCalledTimes(2)
  expect(firstSuccess).not.toHaveBeenCalled()
  expect(secondSuccess).toHaveBeenCalledOnce()
  finishFirst()
  await vi.waitFor(() =>
    expect(record).toHaveBeenCalledWith('Group A', 'Node A'),
  )
  expect(firstSuccess).toHaveBeenCalledOnce()
})

it('executes every requested group once from a single hook instance', async () => {
  let finishFirst!: () => void
  vi.mocked(selectNodeForGroup)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFirst = resolve
        }),
    )
    .mockResolvedValueOnce(undefined)
    .mockResolvedValueOnce(undefined)
  const success = vi.fn()
  const selection = useProxySelection({ onSuccess: success })

  selection.changeProxy('Group A', 'Node A')
  selection.changeProxy('Group B', 'Node B')
  selection.changeProxy('Group C', 'Node C')

  await vi.waitFor(() => expect(selectNodeForGroup).toHaveBeenCalledTimes(1))
  finishFirst()
  await vi.waitFor(() => expect(selectNodeForGroup).toHaveBeenCalledTimes(3))

  expect(vi.mocked(selectNodeForGroup).mock.calls).toEqual([
    ['Group A', 'Node A'],
    ['Group B', 'Node B'],
    ['Group C', 'Node C'],
  ])
  await vi.waitFor(() =>
    expect(record).toHaveBeenCalledWith('Group C', 'Node C'),
  )
  expect(record).toHaveBeenCalledWith('Group A', 'Node A')
  expect(record).toHaveBeenCalledWith('Group B', 'Node B')
  expect(success).toHaveBeenCalledTimes(3)
})
