import { createBrowserRouter, type RouteObject } from 'react-router'

import { NAV_ITEMS } from '@/config/navigation'

import Layout from './layout'
import { RouteError, RouteNotFound } from './route-fallbacks'
import { PAGE_ROUTES } from './route-pages'

const pageRoutes: RouteObject[] = NAV_ITEMS.map((item) => {
  const page = PAGE_ROUTES[item.id]

  return {
    path: item.path,
    ...(page.lazy ? { lazy: page.lazy } : { Component: page.Component }),
    // Keep render failures inside the app shell: the error view replaces the
    // page while the sidebar/window chrome keeps working.
    errorElement: <RouteError />,
  }
})

export const router = createBrowserRouter([
  {
    path: '/',
    Component: Layout,
    children: [...pageRoutes, { path: '*', Component: RouteNotFound }],
  },
])
