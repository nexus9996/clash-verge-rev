import { createFileRoute } from '@tanstack/react-router'

import UnlockPage from '@/pages/unlock'

export const Route = createFileRoute('/unlock')({
  component: UnlockPage,
})
