// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { HotkeyInput } from './hotkey-input'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({
        matches: false,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }),
    })
  }

  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const press = (
  input: HTMLInputElement,
  init: KeyboardEventInit,
): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ...init,
  })
  act(() => {
    input.dispatchEvent(event)
  })
  return event
}

test('leaves Tab and Escape to the browser and never records them', async () => {
  const onChange = vi.fn()

  await act(async () => {
    root.render(<HotkeyInput value={[]} onChange={onChange} />)
  })

  const input = container.querySelector('input')
  if (!input) throw new Error('hotkey input was not rendered')

  const tab = press(input, { key: 'Tab', code: 'Tab' })
  expect(tab.defaultPrevented).toBe(false)
  act(() => {
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Tab', bubbles: true }))
  })

  const escape = press(input, { key: 'Escape', code: 'Escape' })
  expect(escape.defaultPrevented).toBe(false)
  act(() => {
    input.dispatchEvent(
      new KeyboardEvent('keyup', { key: 'Escape', bubbles: true }),
    )
  })

  expect(onChange).not.toHaveBeenCalled()
})

test('records a normal key and emits it on keyup', async () => {
  const onChange = vi.fn()

  await act(async () => {
    root.render(<HotkeyInput value={[]} onChange={onChange} />)
  })

  const input = container.querySelector('input')
  if (!input) throw new Error('hotkey input was not rendered')

  const event = press(input, { key: 'a', code: 'KeyA' })
  expect(event.defaultPrevented).toBe(true)

  act(() => {
    input.dispatchEvent(
      new KeyboardEvent('keyup', { key: 'a', code: 'KeyA', bubbles: true }),
    )
  })

  expect(onChange).toHaveBeenCalledWith(['A'])
})
