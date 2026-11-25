// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { FileInput } from './file-input'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

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

const selectFile = async (input: HTMLInputElement, file: File) => {
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: [file],
  })
  // Browsers populate the value with a fake path; the fix must clear it.
  // jsdom only allows assigning an empty value to file inputs, so model the
  // browser value with an own accessor and assert that the handler clears it.
  let value = `C:\\fakepath\\${file.name}`
  Object.defineProperty(input, 'value', {
    configurable: true,
    get: () => value,
    set: (next: string) => {
      value = String(next)
    },
  })

  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

test('clears the input so the same file can be selected again', async () => {
  const onChange = vi.fn()

  await act(async () => {
    root.render(<FileInput onChange={onChange} />)
  })

  const input = container.querySelector<HTMLInputElement>('input[type="file"]')
  if (!input) throw new Error('file input was not rendered')

  const file = new File(['rules: []'], 'profile.yaml', {
    type: 'text/yaml',
  })

  await selectFile(input, file)
  await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1))
  expect(input.value).toBe('')

  await selectFile(input, file)
  await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(2))
  expect(input.value).toBe('')
})
