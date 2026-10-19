import ArticleRounded from '@mui/icons-material/ArticleRounded'
import ClearRounded from '@mui/icons-material/ClearRounded'
import DnsRounded from '@mui/icons-material/DnsRounded'
import LanguageRounded from '@mui/icons-material/LanguageRounded'
import SearchRounded from '@mui/icons-material/SearchRounded'
import {
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
} from '@mui/material'
import {
  type ChangeEvent,
  type KeyboardEvent,
  useCallback,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'

import type { RuleSearchMode, RuleSearchState } from '@/utils/rule-search'

type Props = {
  onSearch: (state: RuleSearchState) => void
}

export const RuleSearchBox = (props: Props) => {
  const { onSearch } = props
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const [mode, setMode] = useState<RuleSearchMode>('content')

  const modeOptions = useMemo(
    () => [
      {
        mode: 'content' as const,
        label: t('shared.search.content'),
        Icon: ArticleRounded,
      },
      {
        mode: 'domain' as const,
        label: t('shared.search.domain'),
        Icon: LanguageRounded,
      },
      {
        mode: 'cidr' as const,
        label: t('shared.search.cidr'),
        Icon: DnsRounded,
      },
    ],
    [t],
  )

  const placeholder =
    mode === 'domain'
      ? t('shared.search.domainPlaceholder')
      : mode === 'cidr'
        ? t('shared.search.cidrPlaceholder')
        : t('shared.search.contentPlaceholder')

  const submitSearch = useCallback(
    (nextMode: RuleSearchMode, nextText: string) => {
      onSearch({ mode: nextMode, text: nextText.trim() })
    },
    [onSearch],
  )

  const handleTextChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const nextText = event.target.value
      setText(nextText)
      submitSearch(mode, nextText)
    },
    [mode, submitSearch],
  )

  const handleModeChange = useCallback(
    (_event: unknown, nextMode: RuleSearchMode | null) => {
      if (!nextMode) return
      setMode(nextMode)
      submitSearch(nextMode, text)
    },
    [submitSearch, text],
  )

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') submitSearch(mode, text)
    },
    [mode, submitSearch, text],
  )

  const clearSearch = useCallback(() => {
    setText('')
    submitSearch(mode, '')
  }, [mode, submitSearch])

  return (
    <TextField
      hiddenLabel
      fullWidth
      size="small"
      autoComplete="off"
      variant="outlined"
      spellCheck="false"
      value={text}
      placeholder={placeholder}
      sx={{
        '& .MuiInputBase-root': { pl: 0.5, pr: 0.5 },
        input: { py: 0.65, px: 1 },
      }}
      onChange={handleTextChange}
      onKeyDown={handleKeyDown}
      slotProps={{
        input: {
          startAdornment: (
            <InputAdornment position="start" sx={{ mr: 0.5 }}>
              <ToggleButtonGroup
                exclusive
                color="primary"
                size="small"
                value={mode}
                onChange={handleModeChange}
                sx={{
                  '& .MuiToggleButton-root': {
                    minWidth: 30,
                    height: 26,
                    px: 0.75,
                    py: 0,
                  },
                }}
              >
                {modeOptions.map(({ mode: option, label, Icon }) => (
                  <ToggleButton key={option} value={option} aria-label={label}>
                    <Tooltip title={label}>
                      <Icon fontSize="small" />
                    </Tooltip>
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
            </InputAdornment>
          ),
          endAdornment: (
            <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
              {text !== '' && (
                <Tooltip title={t('shared.actions.clear')}>
                  <IconButton
                    size="small"
                    color="primary"
                    sx={{ p: 0.5 }}
                    onClick={clearSearch}
                  >
                    <ClearRounded fontSize="inherit" />
                  </IconButton>
                </Tooltip>
              )}
              <Tooltip title={t('shared.search.action')}>
                <IconButton
                  size="small"
                  color="primary"
                  sx={{ p: 0.5 }}
                  onClick={() => submitSearch(mode, text)}
                >
                  <SearchRounded fontSize="inherit" />
                </IconButton>
              </Tooltip>
            </Stack>
          ),
        },
      }}
    />
  )
}
