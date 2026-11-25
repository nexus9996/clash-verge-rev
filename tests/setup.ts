/**
 * jsdom does not implement ResizeObserver, but dnd-kit (imported through the
 * base component barrel) reads it at module load. Provide a no-op implementation
 * so component tests can import shared UI without a real layout engine.
 */
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  globalThis.ResizeObserver =
    ResizeObserverMock as unknown as typeof ResizeObserver
}
