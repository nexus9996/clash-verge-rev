import { useCallback, useState } from 'react'

import type { SearchState } from '@/components/base'

import { readPageFilter, writePageFilter } from '@/hooks/use-page-filter'

const initialSearch: SearchState = {
  text: '',
  matchCase: false,
  matchWholeWord: false,
  useRegularExpression: false,
}

type PageKey = 'connections' | 'logs'

type PageSearch = {
  state: SearchState
  match: (content: string) => boolean
}

const pageKey = (page: PageKey) => `page-search:${page}`

/**
 * Search state for the list pages, kept across unmount so a navigation
 * round-trip preserves the filter. Reuses the matcher the search box already
 * compiled instead of recompiling the same text a second time.
 */
export const usePageSearch = (page: PageKey) => {
  const [entry, setEntry] = useState<PageSearch>(
    () =>
      readPageFilter<PageSearch>(pageKey(page)) ?? {
        state: initialSearch,
        match: () => true,
      },
  )

  const onSearch = useCallback(
    (match: (content: string) => boolean, state: SearchState) => {
      const next = { state, match }
      writePageFilter(pageKey(page), next)
      setEntry(next)
    },
    [page],
  )

  return { searchState: entry.state, match: entry.match, onSearch }
}
