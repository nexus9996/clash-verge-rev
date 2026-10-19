import { createFileRoute } from '@tanstack/react-router'

import SettingPage from '@/pages/settings'

export const Route = createFileRoute('/settings')({
  component: SettingPage,
})
