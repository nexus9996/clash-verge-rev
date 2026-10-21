import { expect, test } from 'vitest'

import { FALLBACK_LANGUAGE, resolveLanguage } from './i18n'

test('maps Japanese locales to the shipped jp bundle', () => {
  expect(resolveLanguage('ja')).toBe('jp')
  expect(resolveLanguage('ja-JP')).toBe('jp')
  expect(resolveLanguage('ja_JP')).toBe('jp')
})

test('maps traditional Chinese locales to zhtw', () => {
  expect(resolveLanguage('zh-Hant')).toBe('zhtw')
  expect(resolveLanguage('zh-Hant-TW')).toBe('zhtw')
  expect(resolveLanguage('zh-HK')).toBe('zhtw')
  expect(resolveLanguage('zh-MO')).toBe('zhtw')
  expect(resolveLanguage('zh-TW')).toBe('zhtw')
})

test('keeps simplified Chinese and generic base fallbacks', () => {
  expect(resolveLanguage('zh-CN')).toBe('zh')
  expect(resolveLanguage('zh')).toBe('zh')
  expect(resolveLanguage('en-US')).toBe('en')
  expect(resolveLanguage('de-AT')).toBe('de')
})

test('falls back for unsupported languages', () => {
  expect(resolveLanguage('fr-FR')).toBe(FALLBACK_LANGUAGE)
  expect(resolveLanguage()).toBe(FALLBACK_LANGUAGE)
})
