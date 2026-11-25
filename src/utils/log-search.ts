/** Search filtering for the log page. */

export interface SearchableLog {
  type: string
  time?: string
  payload: string
}

/**
 * Builds the text the search box matches against. The original casing is kept
 * so case-sensitive and regular-expression searches behave as configured.
 */
export const getLogSearchText = (log: SearchableLog) =>
  `${log.time ?? ''} ${log.type} ${log.payload}`

export const filterLogsBySearch = <T extends SearchableLog>(
  logs: readonly T[],
  match: (text: string) => boolean,
): T[] => logs.filter((log) => match(getLogSearchText(log)))

export interface LogViewFilter {
  /** Level selection from the toolbar; `all` keeps every level. */
  level: string
  /** Raw search text; empty means "no search", so no per-log matching runs. */
  text: string
  match: (text: string) => boolean
}

/**
 * Visible log rows for the page. Level filtering is a cheap type check, so it
 * runs first; building the searchable text per log is the expensive part and
 * only happens when the search box actually holds text. The unfiltered case
 * returns `logs` by identity so the virtual list is not invalidated every flush.
 */
export const filterLogsForView = <T extends SearchableLog>(
  logs: T[],
  filter: LogViewFilter,
): T[] => {
  if (logs.length === 0) return logs

  const byLevel =
    filter.level === 'all'
      ? logs
      : logs.filter((log) => log.type.includes(filter.level))

  if (!filter.text.trim()) return byLevel

  return filterLogsBySearch(byLevel, filter.match)
}
