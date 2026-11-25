import { expect, test } from 'vitest'

import {
  filterLogsBySearch,
  filterLogsForView,
  getLogSearchText,
} from './log-search'
import { compileStringMatcher } from './search-matcher'

const log = (payload: string, type = 'info', time = '2024/01/01 00:00:00') => ({
  payload,
  type,
  time,
})

test('searches over the original text so case-sensitive queries work', () => {
  const logs = [log('ERROR request failed'), log('error request failed')]

  const { matcher } = compileStringMatcher('ERROR', { matchCase: true })
  expect(filterLogsBySearch(logs, matcher)).toEqual([logs[0]])

  const insensitive = compileStringMatcher('ERROR')
  expect(filterLogsBySearch(logs, insensitive.matcher)).toEqual(logs)
})

test('keeps the original casing for regular expressions', () => {
  const logs = [log('GET /api/users 200'), log('get /api/users 200')]

  const { matcher } = compileStringMatcher('GET\\s+/api', {
    matchCase: true,
    useRegularExpression: true,
  })
  expect(filterLogsBySearch(logs, matcher)).toEqual([logs[0]])
})

test('exposes the full searchable text including time and type', () => {
  expect(getLogSearchText(log('payload', 'warning', '12:00'))).toBe(
    '12:00 warning payload',
  )
  expect(getLogSearchText({ type: 'info', payload: 'p' })).toBe(' info p')
})

test('empty matcher keeps every log', () => {
  const logs = [log('one'), log('two')]
  const { matcher } = compileStringMatcher('')
  expect(filterLogsBySearch(logs, matcher)).toEqual(logs)
})

test('unfiltered view keeps the source array instead of rebuilding it', () => {
  const logs = [log('one'), log('two')]

  const visible = filterLogsForView(logs, {
    level: 'all',
    text: '',
    match: () => true,
  })

  expect(visible).toBe(logs)
})

test('applies the level and text filters in that order', () => {
  const logs = [
    log('connect ok', 'info'),
    log('connect failed', 'error'),
    log('timeout', 'error'),
  ]
  const { matcher } = compileStringMatcher('connect')

  expect(
    filterLogsForView(logs, { level: 'err', text: 'connect', match: matcher }),
  ).toEqual([logs[1]])
  expect(
    filterLogsForView(logs, { level: 'err', text: '', match: () => true }),
  ).toEqual([logs[1], logs[2]])
})
