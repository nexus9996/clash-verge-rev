import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router'

export const Route = createFileRoute('/settings')({
  component: lazyRouteComponent(() => import('@/pages/settings')),
  staticData: { navId: 'settings' },
})
