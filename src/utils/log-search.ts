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
