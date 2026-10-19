import { createRouter } from '@tanstack/react-router'

import { routeTree } from '@/routeTree.gen'

import { RouteError, RouteNotFound } from './route-fallbacks'

export const router = createRouter({
  routeTree,
  defaultErrorComponent: RouteError,
  defaultNotFoundComponent: RouteNotFound,
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
