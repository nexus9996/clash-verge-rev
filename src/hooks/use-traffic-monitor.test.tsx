// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { useTrafficMonitorEnhanced } from './use-traffic-monitor'

const worker = vi.hoisted(() => ({
  posted: [] as Array<{ type: string }>,
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    isVisible: async () => true,
    onFocusChanged: () => Promise.resolve(() => {}),
    onCloseRequested: () => Promise.resolve(() => {}),
  }),
}))

vi.stubGlobal(
  'Worker',
  class {
    onmessage: ((event: MessageEvent) => void) | null = null
    onerror: unknown = null
    postMessage = (message: { type: string }) => {
      worker.posted.push(message)
    }
    terminate = vi.fn()
  },
)

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

const countSnapshotRequests = () =>
  worker.posted.filter((message) => message.type === 'requestSnapshot').length

beforeEach(() => {
  worker.posted.length = 0
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

test('keeps the sampler subscription stable across caller re-renders', async () => {
  const Probe = ({ tick }: { tick: number }) => {
    useTrafficMonitorEnhanced({ subscribe: false, onSnapshot: () => {} })
    return <span>{tick}</span>
  }

  act(() => root.render(<Probe tick={0} />))
  await act(async () => {})
  const afterMount = countSnapshotRequests()

  act(() => root.render(<Probe tick={1} />))
  await act(async () => {})

  // An inline onSnapshot must not re-prime the sampler: re-subscribing here
  // re-runs onSnapshot for snapshots the caller already had.
  expect(countSnapshotRequests()).toBe(afterMount)
})
