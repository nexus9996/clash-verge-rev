import { useEffect, useRef } from 'react'

import { useClash } from '@/hooks/use-clash'
import { getBundledCoreVersion } from '@/services/cmds'
import { hideNotice, showNotice } from '@/services/notice-service'
import { useRunState } from '@/store/app-store-context'
import { coreVersionsDiffer } from '@/utils/core-version'

/**
 * Service mode runs the Service's administrator-approved core copy, which an app update does not
 * replace on its own. Compare it with the bundled core and tell the user how to refresh it instead
 * of letting the old kernel run silently.
 */
export const useServiceCoreDrift = () => {
  const { coreVersion } = useClash()
  const runState = useRunState()
  const notice = useRef<{
    id: number
    running: string
    bundled: string
  } | null>(null)
  const serviceMode = runState?.mode === 'Service'

  useEffect(() => {
    if (!serviceMode || !coreVersion) {
      if (notice.current) hideNotice(notice.current.id)
      notice.current = null
      return
    }

    let cancelled = false
    void getBundledCoreVersion()
      .then((bundled) => {
        if (cancelled) return
        const current = notice.current
        if (!coreVersionsDiffer(coreVersion, bundled)) {
          if (current) hideNotice(current.id)
          notice.current = null
          return
        }
        if (current?.running === coreVersion && current.bundled === bundled) {
          return
        }
        if (current) hideNotice(current.id)
        notice.current = {
          id: showNotice.warning(
            'settings.feedback.notifications.clashService.coreVersionDrift',
            { running: coreVersion, bundled },
            0,
          ),
          running: coreVersion,
          bundled,
        }
      })
      .catch((error) => {
        console.warn('Failed to compare the bundled core version:', error)
      })

    return () => {
      cancelled = true
    }
  }, [coreVersion, serviceMode])
}
