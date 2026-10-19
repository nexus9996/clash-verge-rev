import { createRouter } from '@tanstack/react-router'

import { routeTree } from '@/routeTree.gen'

import { RouteError, RouteNotFound } from './route-fallbacks'
import { ROUTER_DEFAULTS } from './router-options'

export const router = createRouter({
  routeTree,
  defaultErrorComponent: RouteError,
  defaultNotFoundComponent: RouteNotFound,
  ...ROUTER_DEFAULTS,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
