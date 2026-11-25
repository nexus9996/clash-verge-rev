export const formatRouteError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)
