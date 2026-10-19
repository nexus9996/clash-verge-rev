/**
 * Navigation behavior defaults. The pending thresholds keep fast chunk loads
 * from flashing a loading state, while intent preload hides the cold path.
 */
export const ROUTER_DEFAULTS = {
  defaultPreload: 'intent',
  defaultPreloadDelay: 0,
  defaultPendingMs: 200,
  defaultPendingMinMs: 300,
} as const
