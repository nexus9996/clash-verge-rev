import AccountTreeRounded from '@mui/icons-material/AccountTreeRounded'
import { alpha, Box, IconButton, Menu, MenuItem, Tooltip } from '@mui/material'
import { type MouseEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  groups: readonly string[]
  onGroupLocation?: (groupName: string) => void
}

export const ProxyGroupJump = (props: Props) => {
  const { groups, onGroupLocation } = props
  const { t } = useTranslation()
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)

  if (!onGroupLocation || groups.length === 0) return null

  const jumpTo = (groupName: string) => {
    setAnchorEl(null)
    onGroupLocation(groupName)
  }

  const handleJump = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (groups.length === 1) {
      jumpTo(groups[0])
      return
    }
    setAnchorEl(event.currentTarget)
  }

  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        mr: 1,
        verticalAlign: 'middle',
      }}
    >
      <Box
        component="span"
        sx={(theme) => ({
          px: 0.5,
          py: 0.125,
          borderRadius: 0.75,
          color: 'primary.main',
          bgcolor: alpha(theme.palette.primary.main, 0.12),
          fontSize: 10,
          fontWeight: 500,
          lineHeight: 1.4,
          flexShrink: 0,
        })}
      >
        {t('proxies.page.labels.groupBadge')}
      </Box>
      <Tooltip
        title={t('proxies.page.tooltips.jumpToGroup')}
        placement="top"
        arrow
      >
        <IconButton
          size="small"
          sx={(theme) => ({
            width: 22,
            height: 22,
            borderRadius: 1,
            color: 'primary.main',
            bgcolor: alpha(
              theme.palette.primary.main,
              theme.palette.mode === 'light' ? 0.08 : 0.16,
            ),
            '&:hover': {
              bgcolor: alpha(
                theme.palette.primary.main,
                theme.palette.mode === 'light' ? 0.18 : 0.28,
              ),
            },
          })}
          onClick={handleJump}
        >
          <AccountTreeRounded sx={{ fontSize: 15 }} />
        </IconButton>
      </Tooltip>
      <Menu
        anchorEl={anchorEl}
        open={anchorEl !== null}
        onClose={() => setAnchorEl(null)}
        onClick={(event) => event.stopPropagation()}
      >
        {groups.map((groupName) => (
          <MenuItem
            key={groupName}
            dense
            onClick={() => jumpTo(groupName)}
            sx={{ fontSize: 13 }}
          >
            {groupName}
          </MenuItem>
        ))}
      </Menu>
    </Box>
  )
}
