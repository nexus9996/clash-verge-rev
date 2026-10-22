import {
  createElement,
  isValidElement,
  ReactNode,
  useEffect,
  useRef,
} from 'react'

import noop from '@/utils/noop'

import { createLatestSaver, type LatestSaver } from './guard-state-saver'

interface Props<Value> {
  value?: Value
  valueProps?: string
  onChangeProps?: string
  waitTime?: number
  onChange?: (value: Value) => void
  onFormat?: (...args: any[]) => Value
  onGuard?: (value: Value, oldValue: Value) => Promise<void>
  onCatch?: (error: Error) => void
  children: ReactNode
}

export function GuardState<T>(props: Props<T>) {
  const {
    value,
    children,
    valueProps = 'value',
    onChangeProps = 'onChange',
    waitTime = 0, // debounce wait time default 0
    onGuard = noop,
    onCatch = noop,
    onChange = noop,
    onFormat,
  } = props

  const handlersRef = useRef({
    onChange,
    onCatch,
    onGuard,
    onFormat,
  })
  handlersRef.current = { onChange, onCatch, onGuard, onFormat }

  const saverRef = useRef<LatestSaver<T> | null>(null)
  if (!saverRef.current) {
    saverRef.current = createLatestSaver<T>({
      waitTime,
      initialCommitted: value as T,
      onSave: (newValue, previous) =>
        handlersRef.current.onGuard(newValue, previous),
      onRollback: (committed) => handlersRef.current.onChange(committed),
      onCatch: (error) => handlersRef.current.onCatch(error),
    })
  }

  useEffect(() => () => saverRef.current?.dispose(), [])

  if (!isValidElement(children)) {
    return children as any
  }

  const childProps = { ...(children.props as Record<string, any>) }

  childProps[valueProps] = value
  childProps[onChangeProps] = (...args: any[]) => {
    const {
      onChange: emitChange,
      onCatch: emitCatch,
      onFormat: format,
    } = handlersRef.current

    let newValue: T
    try {
      newValue = format ? format(...args) : (args[0] as T)
    } catch (err: any) {
      emitCatch(err)
      return
    }

    // The local value updates immediately; persistence is debounced and only
    // the latest value is saved, so typing is never blocked by a pending save.
    emitChange(newValue)
    saverRef.current?.change(newValue)
  }
  const { children: nestedChildren, ...restProps } = childProps

  return createElement(children.type, restProps, nestedChildren)
}
