// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const cmds = vi.hoisted(() => ({
  getRuntimeState: vi.fn(async () => ({ mode: 'NotRunning' })),
  getPendingFailures: vi.fn(async () => []),
  getSidecarFailure: vi.fn(async () => null),
}))

vi.mock('@/services/cmds', () => cmds)

import { AppStoreProvider } from './app-store'

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
let frames: FrameRequestCallback[]
let documentState: DocumentVisibilityState

const flushMicrotasks = () => act(async () => {})
const flushFrame = () =>
  act(() => {
    while (frames.length > 0) frames.shift()?.(0)
  })

beforeEach(() => {
  frames = []
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback)
    return frames.length
  })
  vi.stubGlobal('cancelAnimationFrame', () => {})
  documentState = 'visible'
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => documentState,
  })
  cmds.getRuntimeState.mockClear()
  cmds.getPendingFailures.mockClear()

  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

test('leaves the initial snapshots to the event bus', async () => {
  act(() => root.render(<AppStoreProvider>child</AppStoreProvider>))
  await flushMicrotasks()

  expect(cmds.getRuntimeState).not.toHaveBeenCalled()
  expect(cmds.getPendingFailures).not.toHaveBeenCalled()
})

test('coalesces a focus transition into one re-read', async () => {
  act(() => root.render(<AppStoreProvider>child</AppStoreProvider>))
  await flushMicrotasks()

  act(() => {
    window.dispatchEvent(new Event('focus'))
    document.dispatchEvent(new Event('visibilitychange'))
  })
  expect(frames).toHaveLength(1)

  flushFrame()
  await flushMicrotasks()

  expect(cmds.getRuntimeState).toHaveBeenCalledTimes(1)
  expect(cmds.getPendingFailures).toHaveBeenCalledTimes(1)
})
