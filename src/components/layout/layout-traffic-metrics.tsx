import {
  ArrowDownwardRounded,
  ArrowUpwardRounded,
  MemoryRounded,
} from '@mui/icons-material'
import type { BoxProps, SvgIconProps, TypographyProps } from '@mui/material'
import { Box, Typography } from '@mui/material'
import { type RefObject, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { useMemoryData } from '@/hooks/use-memory-data'
import { useTrafficData } from '@/hooks/use-traffic-data'
import parseTraffic from '@/utils/parse-traffic'

import type { TrafficRef } from './traffic-graph'

interface Props {
  enabled: boolean
  displayMemory: boolean
  graphRef: RefObject<TrafficRef | null>
}

const boxStyle: Pick<BoxProps, 'sx'> = {
  sx: {
    display: 'flex',
    alignItems: 'center',
    whiteSpace: 'nowrap',
  },
}
const iconStyle: Pick<SvgIconProps, 'sx'> = {
  sx: { mr: '8px', fontSize: 16 },
}
const valStyle: Pick<TypographyProps, 'component' | 'sx'> = {
  component: 'span',
  sx: { flex: '1 1 56px', userSelect: 'none', textAlign: 'center' },
}
const unitStyle: Pick<TypographyProps, 'component' | 'color' | 'sx'> = {
  component: 'span',
  color: 'grey.500',
  sx: {
    flex: '0 1 27px',
    userSelect: 'none',
    fontSize: '12px',
    textAlign: 'right',
  },
}

/**
 * The 200ms traffic/memory stream is owned by this leaf: the footer shell keeps
 * the canvas ref but never subscribes, so only these numbers re-render.
 * The graph is still fed on every traffic update through the shared ref.
 */
export const LayoutTrafficMetrics = (props: Props) => {
  const { enabled, displayMemory, graphRef } = props
  const { t } = useTranslation()

  const {
    response: { data: traffic },
  } = useTrafficData({ enabled })
  const {
    response: { data: memory },
  } = useMemoryData({ enabled: displayMemory && enabled })

  useEffect(() => {
    graphRef.current?.appendData({
      up: traffic?.up || 0,
      down: traffic?.down || 0,
      upTotal: traffic?.upTotal || 0,
      downTotal: traffic?.downTotal || 0,
    })
  }, [graphRef, traffic])

  const [up, upUnit] = parseTraffic(traffic?.up || 0)
  const [down, downUnit] = parseTraffic(traffic?.down || 0)
  const [inuse, inuseUnit] = parseTraffic(memory?.inuse || 0)

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
      <Box
        title={`${t('home.components.traffic.metrics.uploadSpeed')}`}
        {...boxStyle}
        sx={{
          ...boxStyle.sx,
        }}
      >
        <ArrowUpwardRounded
          {...iconStyle}
          color={(traffic?.up || 0) > 0 ? 'secondary' : 'disabled'}
        />
        <Typography {...valStyle} color="secondary">
          {up}
        </Typography>
        <Typography {...unitStyle}>{upUnit}/s</Typography>
      </Box>

      <Box
        title={`${t('home.components.traffic.metrics.downloadSpeed')}`}
        {...boxStyle}
        sx={{
          ...boxStyle.sx,
        }}
      >
        <ArrowDownwardRounded
          {...iconStyle}
          color={(traffic?.down || 0) > 0 ? 'primary' : 'disabled'}
        />
        <Typography {...valStyle} color="primary">
          {down}
        </Typography>
        <Typography {...unitStyle}>{downUnit}/s</Typography>
      </Box>

      {displayMemory && (
        <Box
          title={`${t('home.components.traffic.metrics.memoryUsage')} `}
          {...boxStyle}
          sx={{
            ...boxStyle.sx,
            cursor: 'auto',
          }}
          color={'disabled'}
        >
          <MemoryRounded {...iconStyle} />
          <Typography {...valStyle}>{inuse}</Typography>
          <Typography {...unitStyle}>{inuseUnit}</Typography>
        </Box>
      )}
    </Box>
  )
}
