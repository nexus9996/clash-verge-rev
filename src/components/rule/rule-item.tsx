import { Box, Switch, styled, Tooltip, Typography } from '@mui/material'
import { useTranslation } from 'react-i18next'
import { Rule } from 'tauri-plugin-mihomo-api'

import type { RuleExtraInfo } from '@/services/cmds'

const Item = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  padding: '4px 16px',
  color: theme.palette.text.primary,
}))

const COLOR = [
  'primary',
  'secondary',
  'info.main',
  'warning.main',
  'success.main',
]

interface Props {
  value: Rule & { lineNo: number }
  extra?: RuleExtraInfo
  pending?: boolean
  onToggleDisabled?: (disabled: boolean) => void
}

const parseColor = (text: string) => {
  if (text === 'REJECT' || text === 'REJECT-DROP') return 'error.main'
  if (text === 'DIRECT') return 'text.primary'

  let sum = 0
  for (let i = 0; i < text.length; i++) {
    sum += text.charCodeAt(i)
  }
  return COLOR[sum % COLOR.length]
}

const RuleItem = (props: Props) => {
  const { value, extra, pending, onToggleDisabled } = props
  const { t } = useTranslation()
  const disabled = extra?.disabled ?? false

  return (
    <Item
      sx={{
        borderBottom: '1px solid var(--divider-color)',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Typography
        color="text.secondary"
        variant="body2"
        sx={{ lineHeight: 2, minWidth: 30, mr: 2.25, textAlign: 'center' }}
      >
        {value.lineNo}
      </Typography>

      <Box sx={{ userSelect: 'text', flex: 1, minWidth: 0 }}>
        <Typography component="h6" variant="subtitle1" color="text.primary">
          {value.payload || '-'}
        </Typography>

        <Typography
          component="span"
          variant="body2"
          color="text.secondary"
          sx={{ mr: 3, minWidth: 120, display: 'inline-block' }}
        >
          {typeof value.type === 'string' ? value.type : value.type.Unknown}
        </Typography>

        <Typography
          component="span"
          variant="body2"
          color={parseColor(value.proxy)}
        >
          {value.proxy}
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, pl: 2 }}>
        {extra && extra.hitCount > 0 && (
          <Typography variant="caption" color="text.secondary" noWrap>
            {t('rules.page.rule.hits', { count: extra.hitCount })}
          </Typography>
        )}
        <Tooltip title={t('rules.page.rule.toggle')}>
          <Switch
            size="small"
            checked={!disabled}
            disabled={pending || !onToggleDisabled}
            onChange={(_event, checked) => onToggleDisabled?.(!checked)}
            slotProps={{ input: { 'aria-label': t('rules.page.rule.toggle') } }}
          />
        </Tooltip>
      </Box>
    </Item>
  )
}

export default RuleItem
