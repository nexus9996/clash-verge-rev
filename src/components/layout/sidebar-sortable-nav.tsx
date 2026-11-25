import {
  DragDropProvider,
  KeyboardSensor,
  PointerSensor,
  type DragEndEvent,
} from '@dnd-kit/react'
import { isSortable } from '@dnd-kit/react/sortable'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { SortableItem } from '@/components/base/sortable-item'
import { NAV_ITEMS, type NavigationId } from '@/config/navigation'

import { LayoutItem } from './layout-item'
import { NAV_ICONS } from './navigation-icons'

const SENSORS = [PointerSensor, KeyboardSensor]

const ITEM_BY_PATH = new Map<string, (typeof NAV_ITEMS)[number]>(
  NAV_ITEMS.map((item) => [item.path, item]),
)

interface SidebarSortableNavProps {
  order: string[]
  onMove: (oldIndex: number, newIndex: number) => void | Promise<void>
  preloadPage?: (id: NavigationId) => void
}

/**
 * Drag-and-drop navigation list. It is dynamically imported by the sidebar only
 * while the menu order is unlocked, so dnd-kit never enters the initial bundle.
 */
export default function SidebarSortableNav(props: SidebarSortableNavProps) {
  const { order, onMove, preloadPage } = props
  const { t } = useTranslation()

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { operation, canceled } = event
      const { source, target } = operation

      if (canceled || !target || !isSortable(source)) return

      const { index: newIndex, initialIndex: oldIndex } = source.sortable
      if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return

      void onMove(oldIndex, newIndex)
    },
    [onMove],
  )

  return (
    <DragDropProvider sensors={SENSORS} onDragEnd={handleDragEnd}>
      {order.map((path, index) => {
        const item = ITEM_BY_PATH.get(path)
        if (!item) return null

        const preload = preloadPage ? () => preloadPage(item.id) : undefined

        return (
          <SortableItem key={item.path} id={item.path} index={index}>
            {(sortable) => (
              <LayoutItem
                to={item.path}
                icon={NAV_ICONS[item.id]}
                sortable={sortable}
                preload={preload}
              >
                {t(item.labelKey)}
              </LayoutItem>
            )}
          </SortableItem>
        )
      })}
    </DragDropProvider>
  )
}
