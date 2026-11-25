import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router'

export const Route = createFileRoute('/connections')({
  component: lazyRouteComponent(() => import('@/pages/connections')),
  staticData: { navId: 'connections' },
})
