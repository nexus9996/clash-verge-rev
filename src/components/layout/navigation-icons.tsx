import DnsOutlinedIcon from '@mui/icons-material/DnsOutlined'
import ForkRightOutlinedIcon from '@mui/icons-material/ForkRightOutlined'
import HomeOutlinedIcon from '@mui/icons-material/HomeOutlined'
import LanguageOutlinedIcon from '@mui/icons-material/LanguageOutlined'
import LockOpenOutlinedIcon from '@mui/icons-material/LockOpenOutlined'
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined'
import SubjectOutlinedIcon from '@mui/icons-material/SubjectOutlined'
import WifiOutlinedIcon from '@mui/icons-material/WifiOutlined'
import type { ReactNode } from 'react'

import ConnectionsSvg from '@/assets/image/itemicon/connections.svg?react'
import HomeSvg from '@/assets/image/itemicon/home.svg?react'
import LogsSvg from '@/assets/image/itemicon/logs.svg?react'
import ProfilesSvg from '@/assets/image/itemicon/profiles.svg?react'
import ProxiesSvg from '@/assets/image/itemicon/proxies.svg?react'
import RulesSvg from '@/assets/image/itemicon/rules.svg?react'
import SettingsSvg from '@/assets/image/itemicon/settings.svg?react'
import UnlockSvg from '@/assets/image/itemicon/unlock.svg?react'
import type { NavigationId } from '@/config/navigation'

/** Icon set for each navigation entry; presentation only, kept out of the catalog. */
export const NAV_ICONS: Record<NavigationId, ReactNode[]> = {
  home: [<HomeOutlinedIcon key="mui" />, <HomeSvg key="svg" />],
  proxies: [<WifiOutlinedIcon key="mui" />, <ProxiesSvg key="svg" />],
  profiles: [<DnsOutlinedIcon key="mui" />, <ProfilesSvg key="svg" />],
  connections: [
    <LanguageOutlinedIcon key="mui" />,
    <ConnectionsSvg key="svg" />,
  ],
  rules: [<ForkRightOutlinedIcon key="mui" />, <RulesSvg key="svg" />],
  logs: [<SubjectOutlinedIcon key="mui" />, <LogsSvg key="svg" />],
  unlock: [<LockOpenOutlinedIcon key="mui" />, <UnlockSvg key="svg" />],
  settings: [<SettingsOutlinedIcon key="mui" />, <SettingsSvg key="svg" />],
}
