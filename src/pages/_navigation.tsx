import DnsOutlinedIcon from '@mui/icons-material/DnsOutlined'
import ForkRightOutlinedIcon from '@mui/icons-material/ForkRightOutlined'
import HomeOutlinedIcon from '@mui/icons-material/HomeOutlined'
import LanguageOutlinedIcon from '@mui/icons-material/LanguageOutlined'
import LockOpenOutlinedIcon from '@mui/icons-material/LockOpenOutlined'
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined'
import SubjectOutlinedIcon from '@mui/icons-material/SubjectOutlined'
import WifiOutlinedIcon from '@mui/icons-material/WifiOutlined'
import { type ReactNode } from 'react'

import ConnectionsSvg from '@/assets/image/itemicon/connections.svg?react'
import HomeSvg from '@/assets/image/itemicon/home.svg?react'
import LogsSvg from '@/assets/image/itemicon/logs.svg?react'
import ProfilesSvg from '@/assets/image/itemicon/profiles.svg?react'
import ProxiesSvg from '@/assets/image/itemicon/proxies.svg?react'
import RulesSvg from '@/assets/image/itemicon/rules.svg?react'
import SettingsSvg from '@/assets/image/itemicon/settings.svg?react'
import UnlockSvg from '@/assets/image/itemicon/unlock.svg?react'

import { navigationItems } from './_navigation-meta'

type NavigationItemBase = (typeof navigationItems)[keyof typeof navigationItems]

export type NavigationPath = NavigationItemBase['path']

export type NavigationItem = NavigationItemBase & {
  icon: ReactNode[]
}

export const navItems: NavigationItem[] = [
  {
    ...navigationItems.home,
    icon: [<HomeOutlinedIcon key="mui" />, <HomeSvg key="svg" />],
  },
  {
    ...navigationItems.proxies,
    icon: [<WifiOutlinedIcon key="mui" />, <ProxiesSvg key="svg" />],
  },
  {
    ...navigationItems.profiles,
    icon: [<DnsOutlinedIcon key="mui" />, <ProfilesSvg key="svg" />],
  },
  {
    ...navigationItems.connections,
    icon: [<LanguageOutlinedIcon key="mui" />, <ConnectionsSvg key="svg" />],
  },
  {
    ...navigationItems.rules,
    icon: [<ForkRightOutlinedIcon key="mui" />, <RulesSvg key="svg" />],
  },
  {
    ...navigationItems.logs,
    icon: [<SubjectOutlinedIcon key="mui" />, <LogsSvg key="svg" />],
  },
  {
    ...navigationItems.unlock,
    icon: [<LockOpenOutlinedIcon key="mui" />, <UnlockSvg key="svg" />],
  },
  {
    ...navigationItems.settings,
    icon: [<SettingsOutlinedIcon key="mui" />, <SettingsSvg key="svg" />],
  },
]
