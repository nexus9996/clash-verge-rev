import { Button, Stack, Typography } from '@mui/material'
import { useTranslation } from 'react-i18next'
import { useNavigate, useRevalidator, useRouteError } from 'react-router'

import { BaseEmpty } from '@/components/base'
import { formatRouteError } from '@/utils/format-route-error'

/**
 * Not-found view for unmatched routes. Renders inside the app shell so the
 * sidebar/window chrome keeps working instead of blanking the webview.
 */
export const RouteNotFound = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()

  return (
    <BaseEmpty
      textKey="shared.statuses.pageNotFound"
      extra={
        <Button
          size="small"
          variant="contained"
          sx={{ mt: 2 }}
          onClick={() => navigate('/')}
        >
          {t('layout.components.navigation.tabs.home')}
        </Button>
      }
    />
  )
}

/**
 * Error view for route render failures: keep the shell alive, show the message
 * and offer retry / back-home instead of a white screen.
 */
export const RouteError = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const revalidator = useRevalidator()
  const error = useRouteError()

  return (
    <Stack
      spacing={2}
      sx={{
        height: '100%',
        p: 4,
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
      }}
    >
      <Typography variant="h6">
        {t('shared.feedback.errors.unexpected')}
      </Typography>
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ maxWidth: 520, wordBreak: 'break-word' }}
      >
        {formatRouteError(error)}
      </Typography>
      <Stack direction="row" spacing={1}>
        <Button
          variant="outlined"
          size="small"
          onClick={() => revalidator.revalidate()}
        >
          {t('shared.actions.retry')}
        </Button>
        <Button variant="contained" size="small" onClick={() => navigate('/')}>
          {t('layout.components.navigation.tabs.home')}
        </Button>
      </Stack>
    </Stack>
  )
}
