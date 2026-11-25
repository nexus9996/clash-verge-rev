import { Box, List, Menu, MenuItem, SvgIcon } from '@mui/material'
import { lazy, Suspense, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import iconDark from '@/assets/image/icon_dark.svg?react'
import iconLight from '@/assets/image/icon_light.svg?react'
import LogoSvg from '@/assets/image/logo.svg?react'
import type { NavigationId } from '@/config/navigation'
import { NAV_ITEMS } from '@/config/navigation'
import { useNavMenuOrder } from '@/hooks/layout'
import { useVerge } from '@/hooks/use-verge'
import { startWindowDragging } from '@/utils/window-drag'

import { LayoutItem } from './layout-item'
import { LayoutTraffic } from './layout-traffic'
import { NAV_ICONS } from './navigation-icons'
import { UpdateButton } from './update-button'

type MenuContextPosition = { top: number; left: number }

interface LayoutSidebarProps {
  isDark: boolean
  isCollapsed: boolean
  preloadPage?: (id: NavigationId) => void
}

// The drag-and-drop implementation is only needed while the menu order is
// unlocked, so keep it (and dnd-kit) out of the initial bundle.
const LazySidebarSortableNav = lazy(() => import('./sidebar-sortable-nav'))

const navigationItems = NAV_ITEMS.map((item) => ({
  ...item,
  icon: NAV_ICONS[item.id],
}))

export const LayoutSidebar = (props: LayoutSidebarProps) => {
  const { isDark, isCollapsed, preloadPage } = props
  const { t } = useTranslation()
  const { verge, mutateVerge, patchVerge } = useVerge()
  const [menuUnlocked, setMenuUnlocked] = useState(false)
  const [menuContextPosition, setMenuContextPosition] =
    useState<MenuContextPosition | null>(null)

  const handleMenuOrderOptimisticUpdate = useCallback(
    (order: string[]) => {
      mutateVerge(
        (prev) => (prev ? { ...prev, menu_order: order } : prev),
        false,
      )
    },
    [mutateVerge],
  )

  const handleMenuOrderPersist = useCallback(
    (order: string[]) => patchVerge({ menu_order: order }),
    [patchVerge],
  )

  const {
    menuOrder,
    navItemMap,
    moveMenuOrder,
    isDefaultOrder,
    resetMenuOrder,
  } = useNavMenuOrder({
    enabled: menuUnlocked,
    items: navigationItems,
    storedOrder: verge?.menu_order,
    onOptimisticUpdate: handleMenuOrderOptimisticUpdate,
    onPersist: handleMenuOrderPersist,
  })

  const handleMenuContextMenu = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      event.preventDefault()
      event.stopPropagation()
      setMenuContextPosition({ top: event.clientY, left: event.clientX })
    },
    [],
  )

  const handleMenuContextClose = useCallback(() => {
    setMenuContextPosition(null)
  }, [])

  const handleResetMenuOrder = useCallback(() => {
    setMenuContextPosition(null)
    void resetMenuOrder()
  }, [resetMenuOrder])

  const handleUnlockMenu = useCallback(() => {
    setMenuUnlocked(true)
    setMenuContextPosition(null)
  }, [])

  const handleLockMenu = useCallback(() => {
    setMenuUnlocked(false)
    setMenuContextPosition(null)
  }, [])

  const handleToggleNavCollapsed = useCallback(() => {
    setMenuContextPosition(null)
    void patchVerge({ collapse_navbar: !isCollapsed })
  }, [isCollapsed, patchVerge])

  // Navigation menu items
  const navMenuItems = menuOrder.map((path) => {
    const item = navItemMap.get(path)
    if (!item) return null

    // Preloading on intent keeps the split pages from flashing a loading state.
    const preload = preloadPage ? () => preloadPage(item.id) : undefined

    return (
      <LayoutItem
        key={item.path}
        to={item.path}
        icon={item.icon}
        preload={preload}
      >
        {t(item.labelKey)}
      </LayoutItem>
    )
  })

  return (
    <div className="layout-content__left">
      {/* Logo */}
      <div className="the-logo" onMouseDown={startWindowDragging}>
        <div
          style={{
            height: '27px',
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          <SvgIcon
            component={isDark ? iconDark : iconLight}
            style={{
              height: '36px',
              width: '36px',
              marginTop: '-3px',
              marginRight: '5px',
              marginLeft: '-3px',
            }}
            inheritViewBox
          />
          <LogoSvg fill={isDark ? 'white' : 'black'} />
        </div>
        <UpdateButton className="the-newbtn" />
      </div>

      {/* Edit navigation menu badge */}
      {menuUnlocked && (
        <Box
          sx={(theme) => ({
            px: 1.5,
            py: 0.75,
            mx: 'auto',
            mb: 1,
            maxWidth: 250,
            borderRadius: 1.5,
            fontSize: 12,
            fontWeight: 600,
            textAlign: 'center',
            color: theme.palette.warning.contrastText,
            bgcolor:
              theme.palette.mode === 'light'
                ? theme.palette.warning.main
                : theme.palette.warning.dark,
          })}
        >
          {t('layout.components.navigation.menu.reorderMode')}
        </Box>
      )}

      {/* Navigation menu */}
      <List className="the-menu" onContextMenu={handleMenuContextMenu}>
        {menuUnlocked ? (
          <Suspense fallback={navMenuItems}>
            <LazySidebarSortableNav
              order={menuOrder}
              onMove={moveMenuOrder}
              preloadPage={preloadPage}
            />
          </Suspense>
        ) : (
          navMenuItems
        )}
      </List>

      {/* Context menu */}
      <Menu
        open={Boolean(menuContextPosition)}
        onClose={handleMenuContextClose}
        anchorReference="anchorPosition"
        anchorPosition={
          menuContextPosition
            ? {
                top: menuContextPosition.top,
                left: menuContextPosition.left,
              }
            : undefined
        }
        transitionDuration={200}
        slotProps={{
          list: {
            sx: { py: 0.5 },
          },
        }}
      >
        <MenuItem onClick={handleToggleNavCollapsed} dense>
          {isCollapsed
            ? t('layout.components.navigation.menu.expandNavBar')
            : t('layout.components.navigation.menu.collapseNavBar')}
        </MenuItem>
        <MenuItem
          onClick={menuUnlocked ? handleLockMenu : handleUnlockMenu}
          dense
        >
          {menuUnlocked
            ? t('layout.components.navigation.menu.lock')
            : t('layout.components.navigation.menu.unlock')}
        </MenuItem>
        <MenuItem
          onClick={handleResetMenuOrder}
          dense
          disabled={isDefaultOrder}
        >
          {t('layout.components.navigation.menu.restoreDefaultOrder')}
        </MenuItem>
      </Menu>

      {/* Traffic */}
      <div className="the-traffic" onMouseDown={startWindowDragging}>
        <LayoutTraffic />
      </div>
    </div>
  )
}
