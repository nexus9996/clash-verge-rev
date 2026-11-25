import {
  alpha,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
} from '@mui/material'
import { useMatchRoute, useNavigate, useRouter } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import type { SortableItemRenderProps } from '@/components/base/sortable-item'
import type { NavigationPath } from '@/config/navigation'
import { useVerge } from '@/hooks/use-verge'

interface Props {
  to: NavigationPath
  children: string
  icon: ReactNode[]
  sortable?: SortableItemRenderProps
}
export const LayoutItem = (props: Props) => {
  const { to, children, icon, sortable } = props
  const { verge } = useVerge()
  const { menu_icon } = verge ?? {}
  const navCollapsed = verge?.collapse_navbar ?? false
  const matchRoute = useMatchRoute()
  const match = Boolean(matchRoute({ to }))
  const navigate = useNavigate()
  const router = useRouter()

  // Preload the route chunk on intent so split pages do not flash loaders.
  const preload = () => {
    void router.preloadRoute({ to }).catch(() => {})
  }

  const effectiveMenuIcon =
    navCollapsed && menu_icon === 'disable' ? 'monochrome' : menu_icon

  return (
    <ListItem
      ref={sortable?.ref}
      style={sortable?.style}
      sx={{ py: 0.5, maxWidth: 250, mx: 'auto', padding: '4px 0px' }}
    >
      <ListItemButton
        ref={sortable?.handleRef}
        selected={!!match}
        sx={[
          {
            borderRadius: 2,
            marginLeft: 1.25,
            paddingLeft: 1,
            paddingRight: 1,
            marginRight: 1.25,
            cursor: 'pointer',
            '& .MuiListItemText-primary': {
              color: 'text.primary',
              fontWeight: '700',
            },
          },
          ({ palette: { mode, primary, text, common } }) => {
            const bgcolor =
              mode === 'light'
                ? alpha(primary.main, 0.15)
                : alpha(primary.main, 0.35)
            const color = mode === 'light' ? text.primary : common.white
            return {
              '&.Mui-selected': { bgcolor },
              '&.Mui-selected:hover': { bgcolor },
              '&.Mui-selected .MuiListItemText-primary': { color },
            }
          },
        ]}
        title={navCollapsed ? children : undefined}
        aria-label={navCollapsed ? children : undefined}
        onClick={() => void navigate({ to })}
        onMouseEnter={preload}
        onFocus={preload}
      >
        {(effectiveMenuIcon === 'monochrome' || !effectiveMenuIcon) && (
          <ListItemIcon
            sx={{
              color: 'text.primary',
              marginLeft: '6px',
              cursor: 'inherit',
            }}
          >
            {icon[0]}
          </ListItemIcon>
        )}
        {effectiveMenuIcon === 'colorful' && (
          <ListItemIcon sx={{ cursor: 'inherit' }}>{icon[1]}</ListItemIcon>
        )}
        <ListItemText
          sx={{
            textAlign: 'center',
            marginLeft: effectiveMenuIcon === 'disable' ? '' : '-35px',
          }}
          primary={children}
        />
      </ListItemButton>
    </ListItem>
  )
}
