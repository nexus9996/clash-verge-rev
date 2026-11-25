import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router'

export const Route = createFileRoute('/profile')({
  component: lazyRouteComponent(() => import('@/pages/profiles')),
  staticData: { navId: 'profiles' },
})
