import { getCurrentWindow } from '@tauri-apps/api/window'
import { useSyncExternalStore } from 'react'

const isDocumentVisible = () =>
  typeof document === 'undefined' || document.visibilityState === 'visible'

/**
 * Window visibility is process-global state, so it is owned by a module store
 * instead of per-hook effects: every consumer used to register its own two
 * Tauri listeners plus one `isVisible` round-trip, and the home page runs four
 * of them at once.
 */
let visible = isDocumentVisible()
const subscribers = new Set<() => void>()
let teardown: (() => void) | null = null
let recheckTimer: ReturnType<typeof setTimeout> | undefined

const setVisible = (next: boolean) => {
  if (next === visible) return
  visible = next
  for (const notify of subscribers) notify()
}

const readWindowVisible = async () => {
  const windowVisible = await getCurrentWindow()
    .isVisible()
    .catch(() => true)
  setVisible(isDocumentVisible() && windowVisible)
}

const scheduleRecheck = () => {
  clearTimeout(recheckTimer)
  recheckTimer = setTimeout(() => {
    recheckTimer = undefined
    void readWindowVisible()
  }, 50)
}

const start = () => {
  if (teardown) return
  const appWindow = getCurrentWindow()

  const handleVisibleEvent = () => {
    void readWindowVisible()
  }
  const handlePointerDown = () => setVisible(true)

  document.addEventListener('focus', handleVisibleEvent)
  document.addEventListener('pointerdown', handlePointerDown)
  document.addEventListener('visibilitychange', handleVisibleEvent)
  window.addEventListener('focus', handleVisibleEvent)

  const unlistenFocusChanged = appWindow.onFocusChanged(scheduleRecheck)
  const unlistenCloseRequested = appWindow.onCloseRequested((event) => {
    // The API wrapper calls window.destroy() when the JS default is left
    // untouched; Rust already prevents the close and hides to tray, and
    // core:window:allow-destroy is intentionally not granted.
    event.preventDefault()
    setVisible(false)
    scheduleRecheck()
  })
  void readWindowVisible()

  teardown = () => {
    if (recheckTimer) {
      clearTimeout(recheckTimer)
      recheckTimer = undefined
    }
    document.removeEventListener('focus', handleVisibleEvent)
    document.removeEventListener('pointerdown', handlePointerDown)
    document.removeEventListener('visibilitychange', handleVisibleEvent)
    window.removeEventListener('focus', handleVisibleEvent)
    void unlistenFocusChanged.then((unlisten) => unlisten())
    void unlistenCloseRequested.then((unlisten) => unlisten())
  }
}

const subscribe = (notify: () => void) => {
  subscribers.add(notify)
  start()
  return () => {
    subscribers.delete(notify)
    if (subscribers.size === 0 && teardown) {
      teardown()
      teardown = null
    }
  }
}

const getSnapshot = () => visible

export const useVisibility = () => useSyncExternalStore(subscribe, getSnapshot)
