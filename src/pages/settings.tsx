import { GitHub, HelpOutlineRounded, Telegram } from '@mui/icons-material'
import { Box, ButtonGroup, IconButton, Grid } from '@mui/material'
import { useLockFn } from 'ahooks'
import { useTranslation } from 'react-i18next'

import { BasePage } from '@/components/base'
import SettingClash from '@/components/setting/setting-clash'
import SettingSystem from '@/components/setting/setting-system'
import SettingVergeAdvanced from '@/components/setting/setting-verge-advanced'
import SettingVergeBasic from '@/components/setting/setting-verge-basic'
import { SettingsSearch } from '@/components/setting/settings-search'
import { showNotice } from '@/services/notice-service'
import { openExternalUrl } from '@/utils/open-external-url'

const cardSx = {
  borderRadius: 2,
  backgroundColor: 'var(--surface-card)',
}

const SettingPage = () => {
  const { t } = useTranslation()

  const onError = (err: any) => {
    showNotice.error(err)
  }

  const toGithubRepo = useLockFn(() =>
    openExternalUrl('https://github.com/clash-verge-rev/clash-verge-rev').catch(
      onError,
    ),
  )

  const toGithubDoc = useLockFn(() =>
    openExternalUrl('https://clash-verge-rev.github.io/index.html').catch(
      onError,
    ),
  )

  const toTelegramChannel = useLockFn(() =>
    openExternalUrl('https://t.me/clash_verge_re').catch(onError),
  )

  return (
    <SettingsSearch>
      {(searchHeader, results, hidden) => (
        <BasePage
          title={t('settings.page.title')}
          header={
            <Box
              sx={{
                display: 'flex',
                gap: 1,
                flexWrap: 'wrap',
                alignItems: 'center',
              }}
            >
              {searchHeader}
              <ButtonGroup
                variant="contained"
                aria-label={t('settings.page.actionsGroupLabel')}
              >
                <IconButton
                  size="medium"
                  color="inherit"
                  title={t('settings.page.actions.manual')}
                  onClick={toGithubDoc}
                >
                  <HelpOutlineRounded fontSize="inherit" />
                </IconButton>
                <IconButton
                  size="medium"
                  color="inherit"
                  title={t('settings.page.actions.telegram')}
                  onClick={toTelegramChannel}
                >
                  <Telegram fontSize="inherit" />
                </IconButton>

                <IconButton
                  size="medium"
                  color="inherit"
                  title={t('settings.page.actions.github')}
                  onClick={toGithubRepo}
                >
                  <GitHub fontSize="inherit" />
                </IconButton>
              </ButtonGroup>
            </Box>
          }
        >
          {results}
          <Grid
            container
            spacing={1.5}
            columns={{ xs: 6, sm: 6, md: 12 }}
            sx={{ display: hidden ? 'none' : undefined }}
          >
            <Grid size={6}>
              <Box sx={{ ...cardSx, marginBottom: 1.5 }}>
                <SettingSystem onError={onError} />
              </Box>
              <Box sx={cardSx}>
                <SettingClash onError={onError} />
              </Box>
            </Grid>
            <Grid size={6}>
              <Box sx={{ ...cardSx, marginBottom: 1.5 }}>
                <SettingVergeBasic onError={onError} />
              </Box>
              <Box sx={cardSx}>
                <SettingVergeAdvanced onError={onError} />
              </Box>
            </Grid>
          </Grid>
        </BasePage>
      )}
    </SettingsSearch>
  )
}

export default SettingPage
