import { useEffect, useRef } from 'react'

import { useClash } from '@/hooks/use-clash'
import { getBundledCoreVersion } from '@/services/cmds'
import { showNotice } from '@/services/notice-service'
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
  const reported = useRef(false)
  const serviceMode = runState?.mode === 'Service'

  useEffect(() => {
    if (!serviceMode || !coreVersion || reported.current) return

    let cancelled = false
    void getBundledCoreVersion()
      .then((bundled) => {
        if (cancelled || reported.current) return
        if (!coreVersionsDiffer(coreVersion, bundled)) return
        reported.current = true
        showNotice.warning(
          'settings.feedback.notifications.clashService.coreVersionDrift',
          { running: coreVersion, bundled },
          0,
        )
      })
      .catch((error) => {
        console.warn('Failed to compare the bundled core version:', error)
      })

    return () => {
      cancelled = true
    }
  }, [coreVersion, serviceMode])
}
