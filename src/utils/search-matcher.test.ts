import { expect, test } from 'vitest'

import { compileStringMatcher } from './search-matcher'

const match = (query: string, content: string, options = {}) =>
  compileStringMatcher(query, { matchWholeWord: true, ...options }).matcher(
    content,
  )

test('whole-word matching keeps ASCII word boundaries', () => {
  expect(match('test', 'a test case')).toBe(true)
  expect(match('test', 'testing')).toBe(false)
  expect(match('TEST', 'a test case')).toBe(true)
  expect(match('test', 'a Test case', { matchCase: true })).toBe(false)
})

test('whole-word matching falls back to literals for CJK queries', () => {
  expect(match('香港节点', '香港节点 01')).toBe(true)
  expect(match('香港节点', 'HK-香港节点-01')).toBe(true)
  expect(match('香港', '香港节点')).toBe(true)
  expect(match('香港', '新加坡节点')).toBe(false)
})

test('CJK queries are treated literally, not as regular expressions', () => {
  expect(match('香港.节点', '香港.节点')).toBe(true)
  expect(match('香港.节点', '香港X节点')).toBe(false)
})
