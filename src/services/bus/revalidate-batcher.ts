/**
 * Coalesces revalidation requests emitted by the event bus.
 *
 * One config switch arrives as several contract events (and one event may fan
 * out to a long key list), each of which used to revalidate immediately. A
 * trailing window absorbs the burst: the union of requested keys is
 * deduplicated and revalidated once per window.
 */
const REVALIDATE_BATCH_WINDOW_MS = 120

export interface RevalidateBatcher {
  /** Add keys to the open batch, opening a window when none is open. */
  enqueue: (keys: readonly string[]) => void
  /** Cancel the pending window; used by the bus unmount cleanup. */
  dispose: () => void
}

export const createRevalidateBatcher = (
  revalidate: (keys: readonly string[]) => void,
): RevalidateBatcher => {
  const pendingKeys = new Set<string>()
  let timer: ReturnType<typeof setTimeout> | null = null

  const flush = () => {
    timer = null
    if (pendingKeys.size === 0) return
    const keys = [...pendingKeys]
    pendingKeys.clear()
    revalidate(keys)
  }

  const enqueue = (keys: readonly string[]) => {
    for (const key of keys) pendingKeys.add(key)
    // Trailing window: calls inside an open window join it instead of
    // restarting the timer, so a burst flushes at most once per window.
    if (timer === null) timer = setTimeout(flush, REVALIDATE_BATCH_WINDOW_MS)
  }

  const dispose = () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    pendingKeys.clear()
  }

  return { enqueue, dispose }
}
