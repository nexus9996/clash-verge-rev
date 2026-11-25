import { useCallback, useState } from 'react'

/**
 * Page filters outlive page unmount so a navigation round-trip keeps the list
 * filters, but they are cleared when the active profile changes
 * (see {@link resetPageFilters}), so a stale filter never leaks into another
 * profile's data.
 */
const filters = new Map<string, unknown>()

export const readPageFilter = <T>(key: string): T | undefined =>
  filters.get(key) as T | undefined

export const writePageFilter = <T>(key: string, value: T): void => {
  filters.set(key, value)
}

export const resetPageFilters = (): void => {
  filters.clear()
}

/** A state cell that outlives unmount until the active profile changes. */
export const usePageFilter = <T>(key: string, fallback: T) => {
  const [value, setValue] = useState<T>(
    () => readPageFilter<T>(key) ?? fallback,
  )

  const persist = useCallback(
    (next: T) => {
      writePageFilter(key, next)
      setValue(next)
    },
    [key],
  )

  return [value, persist] as const
}
