export interface DiagnosticEntry {
  name: string
  at: number
  ms?: number
  [key: string]: unknown
}

const MAX_ENTRIES = 200
const entries: DiagnosticEntry[] = []

const enabled = () =>
  import.meta.env.DEV || import.meta.env.VITE_NAV_TIMING === '1'

/** Opt-in timing breadcrumbs for the packaged navigation-timing builds. */
export const recordDiagnostic = (
  name: string,
  data: Omit<DiagnosticEntry, 'name' | 'at'> = {},
) => {
  if (!enabled()) return
  entries.push({ name, at: Math.round(performance.now()), ...data })
  if (entries.length > MAX_ENTRIES) entries.shift()
}

export const getDiagnostics = () => entries.slice()

export const clearDiagnostics = () => {
  entries.length = 0
}
