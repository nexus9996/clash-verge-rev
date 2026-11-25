import { Box } from '@mui/material'
import { useTranslation } from 'react-i18next'

import { useTrafficData } from '@/hooks/use-traffic-data'
import parseTraffic from '@/utils/parse-traffic'

interface Props {
  enabled: boolean
}

/**
 * Header totals live in their own component so the 200ms traffic stream only
 * re-renders the two numbers, not the whole connections page and its rows.
 */
export const ConnectionsTrafficSummary = (props: Props) => {
  const { enabled } = props
  const { t } = useTranslation()
  const {
    response: { data: traffic },
  } = useTrafficData({ enabled })

  return (
    <>
      <Box sx={{ mx: 1 }}>
        {t('shared.labels.downloaded')}: {parseTraffic(traffic?.downTotal || 0)}
      </Box>
      <Box sx={{ mx: 1 }}>
        {t('shared.labels.uploaded')}: {parseTraffic(traffic?.upTotal || 0)}
      </Box>
    </>
  )
}
