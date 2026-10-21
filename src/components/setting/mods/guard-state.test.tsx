// @vitest-environment jsdom
import { StrictMode, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { GuardState } from './guard-state'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.useFakeTimers()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
})

const type = (input: HTMLInputElement, value: string) => {
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set
  if (!setValue) throw new Error('input value setter is unavailable')

  act(() => {
    setValue.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

test('applies every keystroke while a debounced save is pending', async () => {
  const onChange = vi.fn()
  const onGuard = vi.fn().mockResolvedValue(undefined)

  await act(async () => {
    root.render(
      <GuardState<number>
        value={80}
        waitTime={400}
        onChange={onChange}
        onGuard={onGuard}
        onFormat={(event: { target: { value: string } }) =>
          Number(event.target.value)
        }
      >
        <input />
      </GuardState>,
    )
  })

  const input = container.querySelector('input')
  if (!input) throw new Error('input was not rendered')

  type(input, '1')
  type(input, '12')
  type(input, '123')

  // The old lock dropped every change after the first for the whole debounce window.
  expect(onChange).toHaveBeenCalledTimes(3)
  expect(onChange).toHaveBeenLastCalledWith(123)

  await act(async () => {
    vi.advanceTimersByTime(400)
  })

  expect(onGuard).toHaveBeenCalledTimes(1)
  expect(onGuard).toHaveBeenCalledWith(123, 80)
})

test('rolls back to the last committed value when the latest save fails', async () => {
  const onChange = vi.fn()
  const onGuard = vi
    .fn()
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error('save failed'))
  const onCatch = vi.fn()

  await act(async () => {
    root.render(
      <GuardState<number>
        value={10}
        onChange={onChange}
        onGuard={onGuard}
        onCatch={onCatch}
        onFormat={(event: { target: { value: string } }) =>
          Number(event.target.value)
        }
      >
        <input />
      </GuardState>,
    )
  })

  const input = container.querySelector('input')
  if (!input) throw new Error('input was not rendered')

  type(input, '20')
  await act(async () => {
    await Promise.resolve()
  })

  type(input, '30')
  await act(async () => {
    await Promise.resolve()
  })

  expect(onGuard).toHaveBeenLastCalledWith(30, 20)
  expect(onChange).toHaveBeenLastCalledWith(20)
  expect(onCatch).toHaveBeenCalledTimes(1)
})

test('still saves after StrictMode replays the mount effect', async () => {
  const onChange = vi.fn()
  const onGuard = vi.fn().mockResolvedValue(undefined)

  await act(async () => {
    root.render(
      <StrictMode>
        <GuardState<number>
          value={80}
          waitTime={400}
          onChange={onChange}
          onGuard={onGuard}
          onFormat={(event: { target: { value: string } }) =>
            Number(event.target.value)
          }
        >
          <input />
        </GuardState>
      </StrictMode>,
    )
  })

  const input = container.querySelector('input')
  if (!input) throw new Error('input was not rendered')

  type(input, '123')

  await act(async () => {
    vi.advanceTimersByTime(400)
  })

  expect(onGuard).toHaveBeenCalledWith(123, 80)
})
