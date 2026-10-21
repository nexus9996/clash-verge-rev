/**
 * One polling timer per shared query: every mounted consumer reads the same
 * SWR cache, so letting each hook own a `refreshInterval` would schedule the
 * same revalidation several times over.
 */
export const createPollingGroup = (revalidate: () => void) => {
  const subscribers = new Map<symbol, number>()
  let timer: ReturnType<typeof setInterval> | null = null

  const syncTimer = () => {
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
    if (subscribers.size === 0) return

    const interval = Math.min(...subscribers.values())
    timer = setInterval(() => {
      if (
        typeof document !== 'undefined' &&
        document.visibilityState === 'hidden'
      ) {
        return
      }
      revalidate()
    }, interval)
  }

  return {
    subscribe(interval: number) {
      const token = Symbol('poller')
      subscribers.set(token, interval)
      syncTimer()

      return () => {
        subscribers.delete(token)
        syncTimer()
      }
    },
  }
}
