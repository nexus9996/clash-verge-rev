import { useCallback, useEffect, useMemo, useReducer } from 'react'

type MenuOrderAction = { type: 'sync'; payload: string[] }

export const areOrdersEqual = (a: string[], b: string[]) =>
  a.length === b.length && a.every((value, index) => value === b[index])

/** Returns a reordered copy, or `null` when the move is a no-op or out of range. */
export const moveOrder = (
  order: string[],
  oldIndex: number,
  newIndex: number,
): string[] | null => {
  if (
    oldIndex < 0 ||
    newIndex < 0 ||
    oldIndex >= order.length ||
    newIndex >= order.length ||
    oldIndex === newIndex
  ) {
    return null
  }

  const next = [...order]
  const [moved] = next.splice(oldIndex, 1)
  if (moved === undefined) return null
  next.splice(newIndex, 0, moved)
  return next
}

const menuOrderReducer = (state: string[], action: MenuOrderAction) => {
  const next = action.payload
  if (areOrdersEqual(state, next)) {
    return state
  }
  return [...next]
}

const createNavLookup = <T extends { path: string }>(items: readonly T[]) => {
  const map = new Map(items.map((item) => [item.path, item] as const))
  const defaultOrder = items.map((item) => item.path)
  return { map, defaultOrder }
}

export const resolveMenuOrder = <T extends { path: string }>(
  order: string[] | null | undefined,
  defaultOrder: string[],
  map: Map<string, T>,
) => {
  const seen = new Set<string>()
  const resolved: string[] = []

  if (Array.isArray(order)) {
    for (const path of order) {
      if (map.has(path) && !seen.has(path)) {
        resolved.push(path)
        seen.add(path)
      }
    }
  }

  for (const path of defaultOrder) {
    if (!seen.has(path)) {
      resolved.push(path)
      seen.add(path)
    }
  }

  return resolved
}

interface UseNavMenuOrderOptions<T extends { path: string }> {
  enabled: boolean
  items: readonly T[]
  storedOrder: string[] | null | undefined
  onOptimisticUpdate?: (order: string[]) => void
  onPersist: (order: string[]) => Promise<void>
}

export const useNavMenuOrder = <T extends { path: string }>({
  enabled,
  items,
  storedOrder,
  onOptimisticUpdate,
  onPersist,
}: UseNavMenuOrderOptions<T>) => {
  const { map: navItemMap, defaultOrder } = useMemo(
    () => createNavLookup(items),
    [items],
  )

  const configMenuOrder = useMemo(
    () => resolveMenuOrder(storedOrder, defaultOrder, navItemMap),
    [storedOrder, defaultOrder, navItemMap],
  )

  const [menuOrder, dispatchMenuOrder] = useReducer(
    menuOrderReducer,
    configMenuOrder,
  )

  useEffect(() => {
    dispatchMenuOrder({ type: 'sync', payload: configMenuOrder })
  }, [configMenuOrder])

  const isDefaultOrder = useMemo(
    () => areOrdersEqual(menuOrder, defaultOrder),
    [menuOrder, defaultOrder],
  )

  const moveMenuOrder = useCallback(
    async (oldIndex: number, newIndex: number) => {
      if (!enabled) {
        return
      }

      const nextOrder = moveOrder(menuOrder, oldIndex, newIndex)
      if (!nextOrder) {
        return
      }

      const previousOrder = [...menuOrder]
      dispatchMenuOrder({ type: 'sync', payload: nextOrder })
      onOptimisticUpdate?.(nextOrder)

      try {
        await onPersist(nextOrder)
      } catch (error) {
        console.error('Failed to update menu order:', error)
        dispatchMenuOrder({ type: 'sync', payload: previousOrder })
        onOptimisticUpdate?.(previousOrder)
      }
    },
    [enabled, menuOrder, onOptimisticUpdate, onPersist],
  )

  const resetMenuOrder = useCallback(async () => {
    if (isDefaultOrder) {
      return
    }

    const previousOrder = [...menuOrder]
    const nextOrder = [...defaultOrder]

    dispatchMenuOrder({ type: 'sync', payload: nextOrder })
    onOptimisticUpdate?.(nextOrder)

    try {
      await onPersist(nextOrder)
    } catch (error) {
      console.error('Failed to reset menu order:', error)
      dispatchMenuOrder({ type: 'sync', payload: previousOrder })
      onOptimisticUpdate?.(previousOrder)
    }
  }, [defaultOrder, isDefaultOrder, menuOrder, onOptimisticUpdate, onPersist])

  return {
    menuOrder,
    navItemMap,
    moveMenuOrder,
    isDefaultOrder,
    resetMenuOrder,
  }
}
