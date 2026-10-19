import './assets/styles/index.scss'

import { ResizeObserver } from '@juggle/resize-observer'
import { RouterProvider } from '@tanstack/react-router'
import { ComposeContextProvider } from 'foxact/compose-context-provider'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { SWRConfig } from 'swr'
import { MihomoWebSocket } from 'tauri-plugin-mihomo-api'

import { router } from './app/router'
import { installRouteTiming } from './app/router-timing'
import { BaseErrorBoundary } from './components/base'
import { preloadHomePageCards } from './pages/home'
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

// Opt-in for packaged navigation-timing builds: pnpm build:nav-timing
if (import.meta.env.DEV || import.meta.env.VITE_NAV_TIMING === '1') {
  installRouteTiming(router)
}

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

const bootstrap = async () => {
  const appDataPromise = preloadAppData()
  void preloadHomePageCards()

  const { initialThemeMode } = await appDataPromise
  initializeApp(initialThemeMode)
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
})

// Page loaded event
window.addEventListener('DOMContentLoaded', () => {
  // Clean up all WebSocket instances to prevent memory leaks
  MihomoWebSocket.cleanupAll()
})
