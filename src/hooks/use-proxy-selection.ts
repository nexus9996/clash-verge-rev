import { useCallback, useRef } from 'react'

import { switchProxyNode } from '@/services/cmds'
import { mutate } from '@/services/mutate'

interface ProxySelectionOptions {
  onError?: (error: any) => void
}

interface ProxyChangeRequest {
  groupName: string
  proxyName: string
  fixed?: string
}

export const useProxySelection = (options: ProxySelectionOptions = {}) => {
  const pendingRequestsRef = useRef<Map<string, ProxyChangeRequest> | null>(
    null,
  )
  const isProcessingRef = useRef(false)
  const getPendingRequests = () => {
    pendingRequestsRef.current ??= new Map()
    return pendingRequestsRef.current
  }

  const { onError } = options

  const executeChange = useCallback(
    async ({ groupName, proxyName, fixed }: ProxyChangeRequest) => {
      try {
        await mutate(
          () => switchProxyNode(groupName, proxyName, fixed === proxyName),
          { id: `select-proxy-node:${groupName}`, errorNotice: false },
        )
      } catch (error) {
        console.error(
          `[ProxySelection] Failed to switch proxy: ${groupName} -> ${proxyName}`,
          error,
        )
        onError?.(error)
      }
    },
    [onError],
  )

  const flushChangeQueue = useCallback(async () => {
    if (isProcessingRef.current) return
    isProcessingRef.current = true

    try {
      // Map keeps insertion order, so every group is applied once; a newer
      // request for the same group replaces the stale pending one.
      while (getPendingRequests().size > 0) {
        const next = getPendingRequests().entries().next().value
        if (!next) break
        const [groupName, request] = next
        getPendingRequests().delete(groupName)
        await executeChange(request)
      }
    } finally {
      isProcessingRef.current = false
      if (getPendingRequests().size > 0) {
        void flushChangeQueue()
      }
    }
  }, [executeChange])

  const select = useCallback(
    (groupName: string, proxyName: string, fixed?: string) => {
      getPendingRequests().set(groupName, {
        groupName,
        proxyName,
        fixed,
      })
      void flushChangeQueue()
    },
    [flushChangeQueue],
  )

  return { select }
}
