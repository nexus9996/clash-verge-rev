import { RefreshRounded, SystemUpdateAltRounded } from '@mui/icons-material'
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Typography,
} from '@mui/material'
import { useLockFn } from 'ahooks'
import dayjs from 'dayjs'
import type { Ref } from 'react'
import { useImperativeHandle, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { BaseDialog, DialogRef } from '@/components/base'
import { useClash, useClashInfo } from '@/hooks/use-clash'
import {
  getCoreVersions,
  installCoreVersion,
  type CoreVersionCatalog,
  upgradeClashCore,
} from '@/services/cmds'
import { mutate } from '@/services/mutate'
import { showNotice } from '@/services/notice-service'

export function MihomoVersionViewer({ ref }: { ref?: Ref<DialogRef> }) {
  const { t } = useTranslation()
  const { mutateVersion } = useClash()
  const { invalidateClashConfig } = useClashInfo()

  const [open, setOpen] = useState(false)
  const [catalog, setCatalog] = useState<CoreVersionCatalog | null>(null)
  const [loading, setLoading] = useState(false)
  const [installing, setInstalling] = useState<string | null>(null)
  const [upgrading, setUpgrading] = useState(false)

  const refresh = useLockFn(async () => {
    setLoading(true)
    try {
      setCatalog(await getCoreVersions())
    } catch (err) {
      showNotice.error(err)
    } finally {
      setLoading(false)
    }
  })

  useImperativeHandle(ref, () => ({
    open: () => {
      setOpen(true)
      void refresh()
    },
    close: () => setOpen(false),
  }))

  const afterCoreChanged = async () => {
    mutateVersion()
    invalidateClashConfig()
    await refresh()
  }

  const onUpgradeLatest = useLockFn(async () => {
    const latestVersion = catalog?.versions[0]?.version ?? ''
    try {
      setUpgrading(true)
      await mutate(() => upgradeClashCore(), {
        id: 'upgrade-clash-core',
        onFulfilled: (report) => {
          showNotice.success(
            report.upgraded
              ? t('settings.modals.clashCore.versions.messages.installed', {
                  version: latestVersion,
                })
              : t('settings.modals.clashCore.versions.messages.alreadyLatest'),
          )
        },
      })
      await afterCoreChanged()
    } catch {
      // the funnel already notified
    } finally {
      setUpgrading(false)
    }
  })

  const onInstall = useLockFn(async (version: string) => {
    try {
      setInstalling(version)
      const result = await mutate(() => installCoreVersion(version), {
        id: 'install-core-version',
        errorNotice: false,
      })
      if (!result.ok) return
      showNotice.success(
        result.value.upgraded
          ? t('settings.modals.clashCore.versions.messages.installed', {
              version,
            })
          : t('settings.modals.clashCore.versions.messages.alreadyInstalled', {
              version,
            }),
      )
      await afterCoreChanged()
    } catch (err) {
      showNotice.error(err)
    } finally {
      setInstalling(null)
    }
  })

  const versions = catalog?.versions ?? []
  const installed = catalog?.installed
  const latest = versions[0]?.version
  const canUpgrade = Boolean(latest && installed !== latest)
  const busy = installing !== null || upgrading

  return (
    <BaseDialog
      open={open}
      title={t('settings.modals.clashCore.versions.title')}
      contentSx={{
        width: 460,
        maxHeight: 460,
        overflowY: 'auto',
        userSelect: 'text',
      }}
      disableOk
      cancelBtn={t('shared.actions.close')}
      onClose={() => setOpen(false)}
      onCancel={() => setOpen(false)}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
          {catalog
            ? t('settings.modals.clashCore.versions.channel', {
                channel: catalog.channel,
              })
            : t('settings.modals.clashCore.versions.loading')}
        </Typography>
        {canUpgrade && (
          <Button
            size="small"
            variant="contained"
            startIcon={<SystemUpdateAltRounded />}
            loading={upgrading}
            loadingPosition="start"
            disabled={installing !== null || loading}
            onClick={onUpgradeLatest}
          >
            {t('settings.modals.clashCore.versions.upgradeLatest')}
          </Button>
        )}
        <IconButton
          size="small"
          disabled={loading || busy}
          onClick={() => void refresh()}
        >
          <RefreshRounded fontSize="small" />
        </IconButton>
      </Box>

      {loading && versions.length === 0 ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress size={28} />
        </Box>
      ) : versions.length === 0 ? (
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ py: 4, textAlign: 'center' }}
        >
          {t('settings.modals.clashCore.versions.empty')}
        </Typography>
      ) : (
        <List dense disablePadding>
          {versions.map((version, index) => {
            const isInstalled = version.version === installed
            const isLatest = index === 0
            return (
              <ListItemButton
                key={version.version}
                disabled={busy}
                sx={{ borderRadius: 1, my: 0.25 }}
              >
                <ListItemText
                  primary={
                    <Box
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 0.75,
                        minWidth: 0,
                      }}
                    >
                      <Typography
                        component="span"
                        variant="body2"
                        sx={{ fontFamily: 'monospace' }}
                      >
                        {version.version}
                      </Typography>
                      {isLatest && (
                        <Chip
                          size="small"
                          color="primary"
                          variant="outlined"
                          label={t('settings.modals.clashCore.versions.latest')}
                        />
                      )}
                      {isInstalled && (
                        <Chip
                          size="small"
                          color="success"
                          variant="outlined"
                          label={t(
                            'settings.modals.clashCore.versions.installed',
                          )}
                        />
                      )}
                    </Box>
                  }
                  secondary={
                    version.publishedAt
                      ? dayjs(version.publishedAt).format('YYYY-MM-DD HH:mm')
                      : undefined
                  }
                />
                {installing === version.version ? (
                  <CircularProgress size={20} />
                ) : (
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={busy || isInstalled}
                    onClick={(event) => {
                      event.stopPropagation()
                      void onInstall(version.version)
                    }}
                  >
                    {isInstalled
                      ? t('settings.modals.clashCore.versions.installedAction')
                      : t('settings.modals.clashCore.versions.install')}
                  </Button>
                )}
              </ListItemButton>
            )
          })}
        </List>
      )}

      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: 'block', mt: 1.5 }}
      >
        {t('settings.modals.clashCore.versions.description')}
      </Typography>
    </BaseDialog>
  )
}
