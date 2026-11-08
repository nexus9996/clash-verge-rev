// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { useWindowColumns } from './use-window-width'

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const columnsForWidth = (width: number) =>
  width >= 1200 ? 4 : width >= 900 ? 3 : width >= 600 ? 2 : 1

let container: HTMLDivElement
let root: Root
let renders = 0
let bodyWidth = 800

const Probe = () => {
  const columns = useWindowColumns(columnsForWidth)
  renders += 1
  return <span data-columns={columns} />
}

const resizeTo = (width: number) => {
  bodyWidth = width
  act(() => {
    window.dispatchEvent(new Event('resize'))
  })
}

beforeEach(() => {
  renders = 0
  bodyWidth = 800
  Object.defineProperty(document.body, 'clientWidth', {
    configurable: true,
    get: () => bodyWidth,
  })
  // jsdom has no animation frames; run the coalesced resize synchronously.
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0)
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', () => {})
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

const rendered = () =>
  container.querySelector('[data-columns]')?.getAttribute('data-columns')

test('re-renders when the width crosses a column breakpoint', () => {
  act(() => root.render(<Probe />))
  const before = renders

  resizeTo(1000)

  expect(rendered()).toBe('3')
  expect(renders).toBeGreaterThan(before)
})

test('keeps the same value for widths inside one breakpoint', () => {
  act(() => root.render(<Probe />))

  resizeTo(950)
  const afterBreakpoint = renders

  resizeTo(1000)
  resizeTo(1100)

  expect(rendered()).toBe('3')
  expect(renders).toBe(afterBreakpoint)
})
