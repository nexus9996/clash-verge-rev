import { useEffect, useRef, useState } from 'react'

/**
 * Derives a responsive value from the window width while keeping the raw width
 * out of render state: the proxies page only changes at a handful of column
 * breakpoints, so a drag-resize should not re-render the whole list per frame.
 */
export const useWindowColumns = (calculate: (width: number) => number) => {
  const calculateRef = useRef(calculate)
  calculateRef.current = calculate

  const [columns, setColumns] = useState(() =>
    calculate(document.body.clientWidth),
  )

  useEffect(() => {
    const sync = () => {
      const next = calculateRef.current(document.body.clientWidth)
      setColumns((previous) => (previous === next ? previous : next))
    }

    let frame: number | null = null
    const handleResize = () => {
      if (frame !== null) return
      frame = requestAnimationFrame(() => {
        frame = null
        sync()
      })
    }

    window.addEventListener('resize', handleResize)
    sync()

    return () => {
      window.removeEventListener('resize', handleResize)
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [calculate])

  return columns
}
