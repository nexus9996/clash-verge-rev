/**
 * Latest-wins saving for optimistic settings controls.
 *
 * `change` never blocks the caller: the local value is applied immediately and
 * only the most recent value is persisted. A save that fails after a newer
 * change arrived is ignored so a stale failure cannot roll back a newer value.
 */

export type LatestSaverOptions<Value> = {
  /** Debounce window before `onSave` runs; 0 saves on the next tick. */
  waitTime?: number
  initialCommitted: Value
  onSave: (value: Value, previous: Value) => Promise<void> | void
  onRollback: (value: Value) => void
  onCatch?: (error: Error) => void
}

export type LatestSaver<Value> = {
  change: (value: Value) => void
  flush: () => void
  dispose: () => void
}

export const createLatestSaver = <Value,>({
  waitTime = 0,
  initialCommitted,
  onSave,
  onRollback,
  onCatch = () => {},
}: LatestSaverOptions<Value>): LatestSaver<Value> => {
  let committed = initialCommitted
  let version = 0
  let pending: Value | undefined
  let hasPending = false
  let ready = false
  let running = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const clearTimer = () => {
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
  }

  const run = async () => {
    if (running || !hasPending || !ready) return

    running = true
    ready = false
    hasPending = false
    const value = pending as Value
    pending = undefined
    const saveVersion = version
    const previous = committed

    try {
      await onSave(value, previous)
      committed = value
    } catch (error) {
      // A newer change arrived while this save was in flight: its failure is
      // stale and must not overwrite the value the user is now editing.
      if (saveVersion === version) {
        onRollback(committed)
        onCatch(error as Error)
      }
    } finally {
      running = false
      if (hasPending && ready) void run()
    }
  }

  return {
    change(value: Value) {
      version += 1
      pending = value
      hasPending = true
      clearTimer()

      if (waitTime <= 0) {
        ready = true
        void run()
        return
      }

      ready = false
      timer = setTimeout(() => {
        timer = undefined
        ready = true
        void run()
      }, waitTime)
    },

    flush() {
      clearTimer()
      ready = true
      void run()
    },

    dispose() {
      // React's StrictMode replays mount effects, so cleanup must not make the
      // saver permanently inert. Dropping the pending work is enough; a
      // genuine unmount never calls `change` again.
      clearTimer()
      hasPending = false
      pending = undefined
    },
  }
}
