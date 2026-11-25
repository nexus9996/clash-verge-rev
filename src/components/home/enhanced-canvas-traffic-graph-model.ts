import {
  formatTrafficHourMinute,
  formatTrafficMinuteSecond,
} from '@/utils/traffic-sampler'

export type TimeRange = 1 | 5 | 10

const MAX_POINTS = 300
const TARGET_FPS = 15
const LINE_WIDTH_UP = 2.5
const LINE_WIDTH_DOWN = 2.5
const LINE_WIDTH_GRID = 0.5
const ALPHA_GRADIENT = 0.15
const ALPHA_LINE = 0.9
const PADDING_TOP = 16
const PADDING_RIGHT = 16
const PADDING_BOTTOM = 32
const PADDING_LEFT = 35

export const GRAPH_CONFIG = {
  maxPoints: MAX_POINTS,
  targetFPS: TARGET_FPS,
  lineWidth: {
    up: LINE_WIDTH_UP,
    down: LINE_WIDTH_DOWN,
    grid: LINE_WIDTH_GRID,
  },
  alpha: {
    gradient: ALPHA_GRADIENT,
    line: ALPHA_LINE,
  },
  padding: {
    top: PADDING_TOP,
    right: PADDING_RIGHT,
    bottom: PADDING_BOTTOM,
    left: PADDING_LEFT,
  },
}

export const STALE_DATA_THRESHOLD = 2500 // ms without fresh data => drop FPS

// Static sx/style identities keep the emotion cache effective; the remaining
// dynamic props (tooltip position, legend colors) stay inline or memoized.
export const rootSx = {
  width: '100%',
  height: '100%',
  position: 'relative',
  bgcolor: 'action.hover',
  borderRadius: 1,
  cursor: 'pointer',
  overflow: 'hidden',
}

export const canvasStyle = {
  width: '100%',
  height: '100%',
  display: 'block',
} as const

export const hoverCanvasStyle = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  display: 'block',
  pointerEvents: 'none',
} as const

export const overlaySx = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  pointerEvents: 'none',
}

export const timeRangeBadgeSx = {
  position: 'absolute',
  top: 6,
  left: 40,
  fontSize: '11px',
  fontWeight: 'bold',
  color: 'text.secondary',
  cursor: 'pointer',
  pointerEvents: 'all',
  px: 1,
  py: 0.5,
  borderRadius: 0.5,
  bgcolor: 'rgba(0,0,0,0.05)',
  '&:hover': {
    bgcolor: 'rgba(0,0,0,0.1)',
  },
}

export const legendsSx = {
  position: 'absolute',
  top: 6,
  right: 8,
  display: 'flex',
  flexDirection: 'column',
  gap: 0.5,
}

export const chartStyleHintSx = {
  position: 'absolute',
  bottom: 6,
  right: 8,
  fontSize: '10px',
  color: 'text.disabled',
  opacity: 0.7,
}

export const diagnosticsSx = {
  position: 'absolute',
  bottom: 6,
  left: 8,
  fontSize: '9px',
  color: 'text.disabled',
  opacity: 0.6,
  lineHeight: 1.2,
}

export const tooltipTimeSx = { color: 'text.secondary', mb: 0.2 }
export const tooltipUpSx = { color: 'secondary.main', fontWeight: 500 }
export const tooltipDownSx = { color: 'primary.main', fontWeight: 500 }

export interface TimeDisplayStrategy {
  maxLabels: number
  formatTime: (timestamp: number) => string
  intervalSeconds: number
  minPixelDistance: number
}

export const TIME_DISPLAY_STRATEGIES: Record<TimeRange, TimeDisplayStrategy> = {
  1: {
    maxLabels: 6,
    formatTime: formatTrafficMinuteSecond,
    intervalSeconds: 10,
    minPixelDistance: 35,
  },
  5: {
    maxLabels: 6,
    formatTime: formatTrafficHourMinute,
    intervalSeconds: 30,
    minPixelDistance: 38,
  },
  10: {
    maxLabels: 8,
    formatTime: formatTrafficHourMinute,
    intervalSeconds: 60,
    minPixelDistance: 40,
  },
}

// Per-draw buffers live at module scope: drawing runs synchronously on the
// main thread, so slots never overlap a concurrent reader.
const yAxisTicks = [
  { label: '', y: 0 },
  { label: '', y: 0 },
  { label: '', y: 0 },
]
const yAxisTickLabels = new Map<number, string>()
const formatYAxisTickLabel = (bytes: number): string => {
  const cached = yAxisTickLabels.get(bytes)
  if (cached !== undefined) return cached

  const label =
    bytes === 0
      ? '0'
      : bytes < 1024
        ? `${Math.round(bytes)}B`
        : bytes < 1024 * 1024
          ? `${Math.round(bytes / 1024)}KB`
          : `${(bytes / (1024 * 1024)).toFixed(1)}MB`
  if (yAxisTickLabels.size >= 256) yAxisTickLabels.clear()
  yAxisTickLabels.set(bytes, label)
  return label
}

export const getYAxisTicks = (
  topValue: number,
  bottomValue: number,
  height: number,
) => {
  const padding = GRAPH_CONFIG.padding

  const topY = padding.top + 10
  const bottomY = height - padding.bottom - 5
  const middleY = (topY + bottomY) / 2
  const middleValue = (bottomValue + topValue) / 2

  const [bottomTick, middleTick, topTick] = yAxisTicks
  bottomTick.label = formatYAxisTickLabel(bottomValue)
  bottomTick.y = bottomY
  middleTick.label = formatYAxisTickLabel(middleValue)
  middleTick.y = middleY
  topTick.label = formatYAxisTickLabel(topValue)
  topTick.y = topY

  return yAxisTicks
}

interface TimeAxisPoint {
  x: number
  label: string
}

export const timeAxisPoints: TimeAxisPoint[] = []
export const resetTimeAxisPoints = () => {
  timeAxisPoints.length = 0
}
export const pushTimeAxisPoint = (x: number, label: string) => {
  let slot = timeAxisPoints[timeAxisPoints.length]
  if (!slot) {
    slot = { x: 0, label: '' }
    timeAxisPoints.push(slot)
  }
  slot.x = x
  slot.label = label
}

// Gradient stop strings are pure functions of the theme color; the colors
// memo builds them once per theme.
const GRADIENT_ALPHA_HEX = Math.round(GRAPH_CONFIG.alpha.gradient * 255)
  .toString(16)
  .padStart(2, '0')
export const makeGradientStops = (color: string) => ({
  start: `${color}${GRADIENT_ALPHA_HEX}`,
  end: `${color}00`,
})
