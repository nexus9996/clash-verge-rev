import { ErrorOutlineRounded } from '@mui/icons-material'
import { Box, Typography } from '@mui/material'
import { useRef } from 'react'
import { ErrorBoundary } from 'react-error-boundary'
import { useTranslation } from 'react-i18next'

import { useVerge } from '@/hooks/use-verge'
import { useVisibility } from '@/hooks/use-visibility'

import { LayoutTrafficMetrics } from './layout-traffic-metrics'
import { TrafficGraph, type TrafficRef } from './traffic-graph'

const unavailableSx = {
  p: 1,
  minHeight: 60,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  bgcolor: 'error.light',
  borderRadius: 1,
  color: 'error.contrastText',
}

const TrafficUnavailableFallback = () => {
  const { t } = useTranslation()

  return (
    <Box sx={unavailableSx}>
      <ErrorOutlineRounded sx={{ mr: 1, fontSize: 20 }} />
      <Typography variant="caption">
        {t('shared.feedback.errors.trafficUnavailable')}
      </Typography>
    </Box>
  )
}

export const LayoutTraffic = () => {
  const { verge } = useVerge()

  const trafficGraph = verge?.traffic_graph ?? true
  const displayMemory = verge?.enable_memory_usage ?? true

  const trafficRef = useRef<TrafficRef>(null)
  const pageVisible = useVisibility()

  return (
    <ErrorBoundary
      FallbackComponent={TrafficUnavailableFallback}
      onError={(error, errorInfo) =>
        console.error('[LayoutTraffic]', error, errorInfo)
      }
    >
      <Box sx={{ position: 'relative' }}>
        {trafficGraph && pageVisible && (
          <div
            data-window-drag-ignore="true"
            style={{ width: '100%', height: 60, marginBottom: 6 }}
            onClick={trafficRef.current?.toggleStyle}
          >
            <TrafficGraph ref={trafficRef} />
          </div>
        )}

        <LayoutTrafficMetrics
          enabled={pageVisible}
          displayMemory={displayMemory}
          graphRef={trafficRef}
        />
      </Box>
    </ErrorBoundary>
  )
}
