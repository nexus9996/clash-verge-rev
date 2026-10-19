import { createFileRoute } from '@tanstack/react-router'

import ProxyPage from '@/pages/proxies'

export const Route = createFileRoute('/proxies')({
  component: ProxyPage,
})
