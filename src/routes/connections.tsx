import { createFileRoute } from '@tanstack/react-router'

import ConnectionsPage from '@/pages/connections'

export const Route = createFileRoute('/connections')({
  component: ConnectionsPage,
  staticData: { navId: 'connections' },
})
