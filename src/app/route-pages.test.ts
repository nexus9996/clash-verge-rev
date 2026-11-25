import { expect, test, vi } from 'vitest'

vi.mock('@/pages/home', () => ({ default: () => null }))
vi.mock('@/pages/logs', () => ({ default: () => null }))
vi.mock(import('@/services/i18n'), { spy: true })

import { ensureLanguageSections } from '@/services/i18n'

import { PAGE_ROUTES } from './route-pages'

test('a split route resolves only after its locale sections are loaded', async () => {
  let releaseSections = () => {}
  vi.mocked(ensureLanguageSections).mockReturnValue(
    new Promise<void>((resolve) => {
      releaseSections = resolve
    }),
  )

  let settled = false
  const page = PAGE_ROUTES.logs.lazy!().then((module) => {
    settled = true
    return module
  })

  await Promise.resolve()

  expect(ensureLanguageSections).toHaveBeenCalledWith(['logs', 'shared'])
  expect(settled).toBe(false)

  releaseSections()

  await expect(page).resolves.toMatchObject({
    Component: expect.any(Function),
  })
}, 20_000)
