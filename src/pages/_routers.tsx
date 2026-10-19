import { createBrowserRouter, RouteObject } from 'react-router'

import Layout from './_layout'
import { navItems } from './_navigation'

export const router = createBrowserRouter([
  {
    path: '/',
    Component: Layout,
    children: navItems.map(
      (item) =>
        ({
          path: item.path,
          ...(item.lazy ? { lazy: item.lazy } : { Component: item.Component }),
        }) as RouteObject,
    ),
  },
])
