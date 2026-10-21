import './assets/styles/index.scss'

import { ResizeObserver } from '@juggle/resize-observer'
import { RouterProvider } from '@tanstack/react-router'
import { ComposeContextProvider } from 'foxact/compose-context-provider'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { SWRConfig } from 'swr'
import { MihomoWebSocket } from 'tauri-plugin-mihomo-api'

import { router } from './app/router'
import { scheduleWarmup } from './app/warmup'
import { BaseErrorBoundary } from './components/base'
import { disposeTrafficMonitor } from './hooks/use-traffic-monitor'
import { FALLBACK_LANGUAGE, initializeLanguage } from './services/i18n'
import {
  preloadAppData,
  resolveThemeMode,
  getPreloadConfig,
} from './services/preload'
import { swrConfig } from './services/query-client'
import { ThemeModeProvider, UpdateStateProvider } from './services/states'
import { AppStoreProvider } from './store/app-store'
import { disableWebViewShortcuts } from './utils/disable-webview-shortcuts'

if (!window.ResizeObserver) {
  window.ResizeObserver = ResizeObserver
}

const mainElementId = 'root'
const container = document.getElementById(mainElementId)

if (!container) {
  throw new Error(`No container '${mainElementId}' found to render application`)
}

disableWebViewShortcuts()

const initializeApp = (initialThemeMode: 'light' | 'dark') => {
  const contexts = [
    <ThemeModeProvider key="theme" initialState={initialThemeMode} />,
    <AppStoreProvider key="app-store" />,
    <UpdateStateProvider key="update" />,
  ]

  const root = createRoot(container)
  root.render(
    <React.StrictMode>
      <ComposeContextProvider contexts={contexts}>
        <BaseErrorBoundary>
          <SWRConfig value={swrConfig}>
            <RouterProvider router={router} />
          </SWRConfig>
        </BaseErrorBoundary>
      </ComposeContextProvider>
    </React.StrictMode>,
  )
}

// Preloading the home page cards must not pull the whole page into the entry
// graph, so it is imported on demand. Failures only cost the warm cache.
const preloadHomePageCards = () =>
  import('./pages/home')
    .then(({ preloadHomePageCards: preload }) => preload())
    .catch((error) => {
      console.warn('[main.tsx] Failed to preload home page cards:', error)
    })

const bootstrap = async () => {
  const appDataPromise = preloadAppData()
  void preloadHomePageCards()

  const { initialThemeMode } = await appDataPromise
  initializeApp(initialThemeMode)
  scheduleWarmup(router)
}

bootstrap().catch((error) => {
  console.error(
    '[main.tsx] App bootstrap failed, falling back to default language:',
    error,
  )
  initializeLanguage(FALLBACK_LANGUAGE)
    .catch((fallbackError) => {
      console.error(
        '[main.tsx] Fallback language initialization failed:',
        fallbackError,
      )
    })
    .finally(() => {
      initializeApp(resolveThemeMode(getPreloadConfig()))
    })
})

// Error handling
window.addEventListener('error', (event) => {
  console.error('[main.tsx] Global error:', event.error)
})

window.addEventListener('unhandledrejection', (event) => {
  console.error('[main.tsx] Unhandled promise rejection:', event.reason)
})

// Page close/refresh events
window.addEventListener('beforeunload', () => {
  // Clean up all WebSocket instances to prevent memory leaks
  MihomoWebSocket.cleanupAll()
  // The sampler is retained across visibility changes; release it on teardown.
  disposeTrafficMonitor()
})

// Page loaded event
window.addEventListener('DOMContentLoaded', () => {
  // Clean up all WebSocket instances to prevent memory leaks
  MihomoWebSocket.cleanupAll()
})
