import { createFileRoute } from '@tanstack/react-router'

import ProfilePage from '@/pages/profiles'

export const Route = createFileRoute('/profile')({
  component: ProfilePage,
  staticData: { navId: 'profiles' },
})
