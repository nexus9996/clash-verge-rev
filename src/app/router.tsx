import { createRouter } from '@tanstack/react-router'

import { routeTree } from '@/routeTree.gen'

export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  defaultPreloadDelay: 0,
  defaultPendingMs: 200,
  defaultPendingMinMs: 300,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
