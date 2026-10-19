// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ navigate }),
}))

import { RouteError, RouteNotFound } from './route-fallbacks'

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const render = async (node: ReactNode) => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  await act(async () => {
    root.render(node)
  })

  return {
    container,
    unmount: async () => {
      await act(async () => root.unmount())
      container.remove()
    },
  }
}

const findButton = (container: HTMLElement, text: string) =>
  Array.from(container.querySelectorAll('button')).find((button) =>
    button.textContent?.includes(text),
  )

afterEach(() => {
  document.body.innerHTML = ''
  navigate.mockReset()
})

describe('route fallbacks', () => {
  it('renders the not-found view and navigates home', async () => {
    const { container, unmount } = await render(<RouteNotFound />)

    expect(container.textContent).toContain('shared.statuses.pageNotFound')
    const homeButton = findButton(
      container,
      'layout.components.navigation.tabs.home',
    )
    expect(homeButton).toBeTruthy()
    homeButton?.click()
    expect(navigate).toHaveBeenCalledWith({ to: '/' })

    await unmount()
  })

  it('renders the error view, shows the message and retries', async () => {
    const reset = vi.fn()
    const { container, unmount } = await render(
      <RouteError error={new Error('boom')} reset={reset} />,
    )

    expect(container.textContent).toContain('boom')
    findButton(container, 'shared.actions.retry')?.click()
    expect(reset).toHaveBeenCalledOnce()

    await unmount()
  })
})
