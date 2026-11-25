import getSystem from './get-system'

const OS = getSystem()

type HotkeyKeyEvent = {
  nativeEvent: { code: string; key?: string }
}

/** Keys that must keep their native behavior while the recorder is focused. */
export const isPassthroughHotkey = (keyEvent: HotkeyKeyEvent) => {
  const { code, key } = keyEvent.nativeEvent
  return (
    code === 'Tab' || key === 'Tab' || code === 'Escape' || key === 'Escape'
  )
}

export const parseHotkey = (keyEvent: HotkeyKeyEvent) => {
  if (isPassthroughHotkey(keyEvent)) return 'UNIDENTIFIED'

  const nativeEvent = keyEvent.nativeEvent
  const key = nativeEvent.code
  let temp = key.toUpperCase()

  if (temp.startsWith('ARROW')) {
    temp = temp.slice(5)
  } else if (temp.startsWith('DIGIT')) {
    temp = temp.slice(5)
  } else if (temp.startsWith('KEY')) {
    temp = temp.slice(3)
  } else if (temp.endsWith('LEFT')) {
    temp = temp.slice(0, -4)
  } else if (temp.endsWith('RIGHT')) {
    temp = temp.slice(0, -5)
  }

  switch (temp) {
    case 'CONTROL':
      return 'CTRL'
    case 'ALT':
      if (OS === 'macos') {
        return 'OPTION'
      } else {
        return 'ALT'
      }
    case 'META':
    case 'OS':
      return 'CMD'
    case ' ':
      return 'SPACE'
    default:
      return temp
  }
}
