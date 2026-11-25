// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { useVisibility } from './use-visibility'

const tauri = vi.hoisted(() => {
  const focusListeners = new Set<() => void>()
  const closeListeners = new Set<
    (event: { preventDefault: () => void }) => void
  >()
  return {
    focusListeners,
    closeListeners,
    isVisible: vi.fn(async () => true),
    onFocusChanged: vi.fn((callback: () => void) => {
      focusListeners.add(callback)
      return Promise.resolve(() => focusListeners.delete(callback))
    }),
    onCloseRequested: vi.fn(
      (callback: (event: { preventDefault: () => void }) => void) => {
        closeListeners.add(callback)
        return Promise.resolve(() => closeListeners.delete(callback))
      },
    ),
  }
})

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    isVisible: tauri.isVisible,
    onFocusChanged: tauri.onFocusChanged,
    onCloseRequested: tauri.onCloseRequested,
  }),
}))

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
let documentState: DocumentVisibilityState

const Probe = ({ label }: { label: string }) => (
  <span data-probe={label}>{useVisibility() ? 'visible' : 'hidden'}</span>
)

const probe = (label: string) =>
  container.querySelector(`[data-probe="${label}"]`)?.textContent

const flush = () => act(async () => {})

beforeEach(() => {
  tauri.focusListeners.clear()
  tauri.closeListeners.clear()
  tauri.isVisible.mockClear()
  tauri.onFocusChanged.mockClear()
  tauri.onCloseRequested.mockClear()
  documentState = 'visible'
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => documentState,
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

test('shares one window subscription across every consumer', async () => {
  act(() => {
    root.render(
      <>
        <Probe label="a" />
        <Probe label="b" />
      </>,
    )
  })
  await flush()

  expect(tauri.onFocusChanged).toHaveBeenCalledTimes(1)
  expect(tauri.onCloseRequested).toHaveBeenCalledTimes(1)
  expect(tauri.isVisible).toHaveBeenCalledTimes(1)
  expect(tauri.focusListeners.size).toBe(1)
})

test('reports the same visibility to every consumer', async () => {
  act(() => {
    root.render(
      <>
        <Probe label="a" />
        <Probe label="b" />
      </>,
    )
  })
  await flush()

  documentState = 'hidden'
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await flush()

  expect(probe('a')).toBe('hidden')
  expect(probe('b')).toBe('hidden')
})

test('stops the window subscription once the last consumer unmounts', async () => {
  act(() => {
    root.render(<Probe label="a" />)
  })
  await flush()

  act(() => root.render(<></>))
  await flush()

  expect(tauri.focusListeners.size).toBe(0)
  expect(tauri.closeListeners.size).toBe(0)
})
