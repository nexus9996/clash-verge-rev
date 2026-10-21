import { expect, test } from 'vitest'

import { isPassthroughHotkey, parseHotkey } from './parse-hotkey'

const keyEvent = (code: string, key = '', shiftKey = false) => ({
  nativeEvent: { code, key, shiftKey },
})

test('lets Tab, Shift+Tab and Escape through without recording them', () => {
  const tab = keyEvent('Tab', 'Tab')
  const shiftTab = keyEvent('Tab', 'Tab', true)
  const escape = keyEvent('Escape', 'Escape')

  for (const event of [tab, shiftTab, escape]) {
    expect(isPassthroughHotkey(event)).toBe(true)
    expect(parseHotkey(event)).toBe('UNIDENTIFIED')
  }
})

test('parses regular keys and modifiers into hotkey names', () => {
  expect(parseHotkey(keyEvent('KeyA', 'a'))).toBe('A')
  expect(parseHotkey(keyEvent('Digit1', '1'))).toBe('1')
  expect(parseHotkey(keyEvent('ArrowLeft', 'ArrowLeft'))).toBe('LEFT')
  expect(parseHotkey(keyEvent('ControlLeft', 'Control'))).toBe('CTRL')
  expect(parseHotkey(keyEvent('Space', ' '))).toBe('SPACE')
  expect(isPassthroughHotkey(keyEvent('KeyA', 'a'))).toBe(false)
})
