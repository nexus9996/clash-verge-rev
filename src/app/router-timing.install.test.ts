// @vitest-environment jsdom
import type { AnyRouter } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clearRouteTimings,
  getRouteTimingSamples,
  installRouteTiming,
} from './router-timing'

type Listener = (event: unknown) => void

const fakeRouter = () => {
  const listeners = new Map<string, Listener>()
  const router = {
    subscribe: (type: string, listener: Listener) => {
      listeners.set(type, listener)
      return () => listeners.delete(type)
    },
  } as unknown as AnyRouter

  const emit = (type: string, location: { href: string; pathname: string }) => {
    listeners.get(type)?.({
      toLocation: location,
      fromLocation: { pathname: '/' },
      pathChanged: true,
    })
  }

  return { router, emit }
}

const wait = () => new Promise((resolve) => setTimeout(resolve, 80))

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {})
})

afterEach(() => {
  clearRouteTimings()
  window.localStorage.removeItem('verge.routeTiming')
  delete window.__vergeNavTiming
  vi.restoreAllMocks()
})

describe('installRouteTiming', () => {
  it('records cold and hot navigations after the render frame when auto-started', async () => {
    window.localStorage.setItem('verge.routeTiming', '1')
    const { router, emit } = fakeRouter()
    installRouteTiming(router)

    emit('onBeforeNavigate', { href: '/proxies', pathname: '/proxies' })
    emit('onRendered', { href: '/proxies', pathname: '/proxies' })
    await wait()

    emit('onBeforeNavigate', { href: '/proxies', pathname: '/proxies' })
    emit('onRendered', { href: '/proxies', pathname: '/proxies' })
    await wait()

    const samples = getRouteTimingSamples()
    expect(samples).toHaveLength(2)
    expect(samples[0]).toMatchObject({ to: '/proxies', cold: true })
    expect(samples[1]).toMatchObject({ to: '/proxies', cold: false })

    const report = window.__vergeNavTiming?.getReport()
    expect(report?.total).toBe(2)
    expect(report?.cold.count).toBe(1)
    expect(report?.hot.count).toBe(1)
  })

  it('stays inert until start() and honors stop()', async () => {
    const { router, emit } = fakeRouter()
    installRouteTiming(router)

    emit('onBeforeNavigate', { href: '/rules', pathname: '/rules' })
    emit('onRendered', { href: '/rules', pathname: '/rules' })
    await wait()
    expect(getRouteTimingSamples()).toHaveLength(0)
    expect(window.__vergeNavTiming?.getReport().total).toBe(0)

    window.__vergeNavTiming?.start()
    emit('onBeforeNavigate', { href: '/rules', pathname: '/rules' })
    emit('onRendered', { href: '/rules', pathname: '/rules' })
    await wait()
    expect(getRouteTimingSamples()).toHaveLength(1)

    window.__vergeNavTiming?.stop()
    emit('onBeforeNavigate', { href: '/rules', pathname: '/rules' })
    emit('onRendered', { href: '/rules', pathname: '/rules' })
    await wait()
    expect(getRouteTimingSamples()).toHaveLength(1)
  })
})
