import { useCallback, useSyncExternalStore } from 'react'

import delayManager, {
  GROUP_KEY_SEPARATOR,
  groupDelayKey,
  type DelaySnapshot,
} from '@/services/delay'
import type { ResolvedProxyMember } from '@/types/proxy-view'

const NO_DELAYS: DelaySnapshot = { of: () => -1 }

/** Exposes the external delay store to React, updating sort order only after a test settles. */
export const useGroupDelays = (group: string | null): DelaySnapshot => {
  const subscribe = useCallback(
    (onSettle: () => void) =>
      group ? delayManager.addGroupListener(group, onSettle) : () => {},
    [group],
  )
  const read = useCallback(
    () => (group ? delayManager.groupDelays(group) : NO_DELAYS),
    [group],
  )

  return useSyncExternalStore(subscribe, read, read)
}

/** A closed menu observes only its current member, not every settled group delay. */
export const useMemberDelay = (
  group: string | null,
  member: ResolvedProxyMember | undefined,
  menuOpen: boolean,
): DelaySnapshot | number => {
  const subscribe = useCallback(
    (onSettle: () => void) =>
      group ? delayManager.addGroupListener(group, onSettle) : () => {},
    [group],
  )
  const read = useCallback(
    () =>
      group && menuOpen
        ? delayManager.groupDelays(group)
        : group && member
          ? delayManager.getDelayFix(member, group)
          : -1,
    [group, member, menuOpen],
  )

  return useSyncExternalStore(subscribe, read, read)
}

/** Preserves unchanged group snapshot identities when another group settles. */
export const useGroupsDelays = (
  groups: readonly string[],
): ReadonlyMap<string, DelaySnapshot> => {
  // Subscribe by group membership; callers rebuild the array on every render.
  const groupKey = groupDelayKey(groups)

  const subscribe = useCallback(
    (onSettle: () => void) => {
      const names = groupKey ? groupKey.split(GROUP_KEY_SEPARATOR) : []
      const unsubscribes = names.map((name) =>
        delayManager.addGroupListener(name, onSettle),
      )
      return () => {
        for (const unsubscribe of unsubscribes) unsubscribe()
      }
    },
    [groupKey],
  )

  const read = useCallback(
    () => delayManager.groupsDelays(groupKey),
    [groupKey],
  )

  return useSyncExternalStore(subscribe, read, read)
}
