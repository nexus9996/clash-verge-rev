import { useLockFn } from 'ahooks'
import { useCallback, useEffect, useReducer } from 'react'

import delayManager, { type DelayUpdate } from '@/services/delay'
import {
  isInteractableMember,
  memberDetails,
  type ResolvedProxyMember,
} from '@/types/proxy-view'

const PRESET_PROXY_NAMES = [
  'DIRECT',
  'REJECT',
  'REJECT-DROP',
  'PASS',
  'COMPATIBLE',
]

const identity = (previous: DelayUpdate, next: DelayUpdate): DelayUpdate =>
  previous.delay === next.delay &&
  previous.elapsed === next.elapsed &&
  previous.updatedAt === next.updatedAt
    ? previous
    : next

const INITIAL_DELAY: DelayUpdate = { delay: -1, updatedAt: 0 }

export interface UseProxyDelayState {
  delayState: DelayUpdate
  delayValue: number
  isPreset: boolean
  timeout: number
  onDelay: () => Promise<void>
}

export function useProxyDelayState(
  member: ResolvedProxyMember,
  groupName: string,
  /** Owned by the parent renderer so every mounted row need not read all of verge. */
  timeout: number,
): UseProxyDelayState {
  const name = member.ref.name
  const details = memberDetails(member)
  const unresolved = member.kind === 'unresolved'
  const isPreset = unresolved || PRESET_PROXY_NAMES.includes(name)
  const [delayState, setDelayState] = useReducer(identity, INITIAL_DELAY)

  useEffect(() => {
    if (isPreset) return
    delayManager.setListener(name, groupName, setDelayState)
    return () => {
      delayManager.removeListener(name, groupName)
    }
  }, [name, groupName, isPreset])

  const updateDelay = useCallback(() => {
    if (unresolved) {
      setDelayState(INITIAL_DELAY)
      return
    }
    const cachedUpdate = delayManager.getDelayUpdate(name, groupName)
    if (cachedUpdate) {
      setDelayState({ ...cachedUpdate })
      return
    }

    const fallbackDelay = delayManager.getDelayFix(member, groupName)
    if (fallbackDelay === -1) {
      setDelayState({ delay: -1, updatedAt: 0 })
      return
    }

    let updatedAt = 0
    const history = details?.history
    if (history && history.length > 0) {
      const lastRecord = history[history.length - 1]
      const parsed = Date.parse(lastRecord.time)
      if (!Number.isNaN(parsed)) {
        updatedAt = parsed
      }
    }

    setDelayState({ delay: fallbackDelay, updatedAt })
  }, [details?.history, groupName, member, name, unresolved])

  useEffect(() => {
    updateDelay()
  }, [updateDelay])

  const onDelay = useLockFn(async () => {
    if (!isInteractableMember(member)) return
    setDelayState({ delay: -2, updatedAt: Date.now() })
    setDelayState(await delayManager.checkDelay(member, groupName, timeout))
  })

  return {
    delayState,
    delayValue: delayState.delay,
    isPreset,
    timeout,
    onDelay,
  }
}
