import CloseRounded from '@mui/icons-material/CloseRounded'
import FilterAltRounded from '@mui/icons-material/FilterAltRounded'
import SearchRounded from '@mui/icons-material/SearchRounded'
import {
  Box,
  Chip,
  ClickAwayListener,
  IconButton,
  InputBase,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Popper,
  Tooltip,
  Typography,
} from '@mui/material'
import { type ChangeEvent, useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  CONNECTION_FILTER_FIELDS,
  type ConnectionFilter,
  type ConnectionFilterField,
  type FilterableConnection,
  createConnectionFilterMatcher,
  getConnectionFieldValues,
  getConnectionFilterKey,
} from '@/utils/connection-filter'

const EMPTY_VALUES: string[] = []

type Props = {
  connections: readonly FilterableConnection[]
  filters: readonly ConnectionFilter[]
  onChange: (filters: ConnectionFilter[]) => void
}

export const ConnectionFilterBox = (props: Props) => {
  const { connections, filters, onChange } = props
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [activeField, setActiveField] = useState<ConnectionFilterField>('host')
  const [valueSearch, setValueSearch] = useState('')
  const filterButtonRef = useRef<HTMLButtonElement | null>(null)
  const valueListRef = useRef<HTMLDivElement | null>(null)

  const fieldLabels = useMemo<Record<ConnectionFilterField, string>>(
    () => ({
      host: t('connections.components.fields.host'),
      sourceIP: t('connections.components.fields.sourceIp'),
      sourcePort: t('connections.components.fields.sourcePort'),
      destinationIP: t('connections.components.fields.destinationIp'),
      destinationPort: t('connections.components.fields.destinationPort'),
      remoteDestination: t('connections.components.fields.destination'),
      network: t('connections.components.fields.network'),
      type: t('connections.components.fields.type'),
      process: t('connections.components.fields.process'),
      rule: t('connections.components.fields.rule'),
      chains: t('connections.components.fields.chains'),
    }),
    [t],
  )

  const fieldValues = useMemo(() => {
    if (!open) return new Map<ConnectionFilterField, string[]>()

    const nextMap = new Map<ConnectionFilterField, string[]>()
    for (const field of CONNECTION_FILTER_FIELDS) {
      const matchesOtherFields = createConnectionFilterMatcher(filters, field)
      const values = new Set<string>()
      for (const connection of connections) {
        if (!matchesOtherFields(connection)) continue
        for (const value of getConnectionFieldValues(field, connection)) {
          values.add(value)
        }
      }
      nextMap.set(
        field,
        [...values].sort((left, right) => left.localeCompare(right)),
      )
    }
    return nextMap
  }, [connections, filters, open])

  const selectedFilterKeys = useMemo(
    () => new Set(filters.map(getConnectionFilterKey)),
    [filters],
  )

  const activeFieldValues = fieldValues.get(activeField) ?? EMPTY_VALUES

  const visibleValues = useMemo(() => {
    const query = valueSearch.trim().toLowerCase()
    if (!query) return activeFieldValues
    return activeFieldValues.filter((value) =>
      value.toLowerCase().includes(query),
    )
  }, [activeFieldValues, valueSearch])

  const resetValueListScroll = useCallback(() => {
    if (valueListRef.current) valueListRef.current.scrollTop = 0
  }, [])

  const selectField = useCallback(
    (field: ConnectionFilterField) => {
      resetValueListScroll()
      setValueSearch('')
      setActiveField(field)
    },
    [resetValueListScroll],
  )

  const handleValueSearchChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      resetValueListScroll()
      setValueSearch(event.target.value)
    },
    [resetValueListScroll],
  )

  const toggleFilter = useCallback(
    (field: ConnectionFilterField, value: string) => {
      const filter = { field, value }
      const key = getConnectionFilterKey(filter)
      if (selectedFilterKeys.has(key)) {
        onChange(filters.filter((item) => getConnectionFilterKey(item) !== key))
        return
      }
      onChange([...filters, filter])
    },
    [filters, onChange, selectedFilterKeys],
  )

  const removeFilter = useCallback(
    (filter: ConnectionFilter) => {
      const key = getConnectionFilterKey(filter)
      onChange(filters.filter((item) => getConnectionFilterKey(item) !== key))
    },
    [filters, onChange],
  )

  const openFilter = useCallback(() => {
    resetValueListScroll()
    setValueSearch('')
    setOpen((previous) => !previous)
  }, [resetValueListScroll])

  return (
    <ClickAwayListener onClickAway={() => setOpen(false)}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          minWidth: 0,
        }}
      >
        <Tooltip title={t('connections.components.filters.placeholder')}>
          <IconButton
            ref={filterButtonRef}
            size="small"
            color={open || filters.length > 0 ? 'primary' : 'default'}
            aria-label={t('connections.components.filters.placeholder')}
            sx={{
              flexShrink: 0,
              width: 32,
              height: 32,
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 1,
            }}
            onClick={openFilter}
          >
            <FilterAltRounded fontSize="small" />
          </IconButton>
        </Tooltip>

        {filters.length > 0 && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              minWidth: 0,
              maxWidth: 360,
              overflowX: 'auto',
              overflowY: 'hidden',
              scrollbarWidth: 'none',
              '&::-webkit-scrollbar': { display: 'none' },
            }}
          >
            {filters.map((filter) => (
              <Chip
                key={getConnectionFilterKey(filter)}
                size="small"
                label={`${fieldLabels[filter.field]}: ${filter.value}`}
                onDelete={() => removeFilter(filter)}
                sx={{
                  flexShrink: 0,
                  maxWidth: 200,
                  height: 24,
                  '& .MuiChip-label': {
                    px: 0.75,
                    fontSize: 11,
                  },
                  '& .MuiChip-deleteIcon': {
                    fontSize: 15,
                    mr: 0.25,
                  },
                }}
              />
            ))}
          </Box>
        )}

        {filters.length > 0 && (
          <Tooltip title={t('connections.components.filters.clear')}>
            <IconButton
              size="small"
              sx={{ flexShrink: 0, p: 0.5 }}
              aria-label={t('connections.components.filters.clear')}
              onClick={() => onChange([])}
            >
              <CloseRounded fontSize="small" />
            </IconButton>
          </Tooltip>
        )}

        <Popper
          open={open}
          anchorEl={filterButtonRef.current}
          placement="bottom-start"
          sx={{ zIndex: (theme) => theme.zIndex.modal + 1 }}
        >
          <Paper elevation={6} sx={{ mt: 0.5 }}>
            <Box
              sx={(theme) => ({
                display: 'grid',
                gridTemplateColumns: '160px minmax(0, 1fr)',
                width: 'min(680px, calc(100vw - 48px))',
                height: 340,
                border: `1px solid ${theme.palette.divider}`,
                borderRadius: 1,
                overflow: 'hidden',
              })}
            >
              <List
                dense
                disablePadding
                sx={(theme) => ({
                  minHeight: 0,
                  maxHeight: 340,
                  overflowY: 'auto',
                  borderRight: `1px solid ${theme.palette.divider}`,
                  bgcolor: theme.palette.action.hover,
                })}
              >
                {CONNECTION_FILTER_FIELDS.map((field) => {
                  const selected = field === activeField
                  const count = fieldValues.get(field)?.length ?? 0
                  return (
                    <ListItemButton
                      key={field}
                      selected={selected}
                      disabled={count === 0}
                      onClick={() => selectField(field)}
                      sx={{ minHeight: 32, px: 1.25, py: 0.25 }}
                    >
                      <ListItemText
                        primary={fieldLabels[field]}
                        secondary={count}
                        slotProps={{
                          primary: {
                            noWrap: true,
                            variant: 'caption',
                            sx: { fontWeight: selected ? 700 : 500 },
                          },
                          secondary: { variant: 'caption' },
                        }}
                      />
                    </ListItemButton>
                  )
                })}
              </List>

              <Box sx={{ minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
                <Box
                  sx={(theme) => ({
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    minHeight: 32,
                    px: 1,
                    borderBottom: `1px solid ${theme.palette.divider}`,
                  })}
                >
                  <Typography variant="caption" color="text.secondary" noWrap>
                    {fieldLabels[activeField]}
                  </Typography>
                  <Box
                    sx={(theme) => ({
                      display: 'flex',
                      alignItems: 'center',
                      minWidth: 0,
                      flex: 1,
                      height: 24,
                      px: 0.75,
                      borderRadius: 0.75,
                      bgcolor: theme.palette.action.hover,
                    })}
                  >
                    <SearchRounded
                      fontSize="inherit"
                      color="action"
                      sx={{ mr: 0.5 }}
                    />
                    <InputBase
                      value={valueSearch}
                      placeholder={t(
                        'connections.components.filters.searchValue',
                      )}
                      onChange={handleValueSearchChange}
                      sx={{
                        minWidth: 0,
                        flex: 1,
                        fontSize: 12,
                        '& input': { p: 0, height: 20 },
                      }}
                    />
                    {valueSearch && (
                      <IconButton
                        size="small"
                        sx={{ p: 0.25 }}
                        aria-label={t('connections.components.filters.clear')}
                        onClick={() => {
                          resetValueListScroll()
                          setValueSearch('')
                        }}
                      >
                        <CloseRounded fontSize="inherit" />
                      </IconButton>
                    )}
                  </Box>
                </Box>

                <Box
                  ref={valueListRef}
                  role="listbox"
                  aria-label={fieldLabels[activeField]}
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 0.25,
                    p: 0.75,
                    height: 307,
                    overflowY: 'auto',
                    boxSizing: 'border-box',
                  }}
                >
                  {visibleValues.length > 0 ? (
                    visibleValues.map((value) => {
                      const selected = selectedFilterKeys.has(
                        getConnectionFilterKey({
                          field: activeField,
                          value,
                        }),
                      )
                      return (
                        <Box
                          key={value}
                          role="option"
                          aria-selected={selected}
                          tabIndex={0}
                          onClick={() => toggleFilter(activeField, value)}
                          onKeyDown={(event) => {
                            if (event.key !== 'Enter' && event.key !== ' ') {
                              return
                            }
                            event.preventDefault()
                            toggleFilter(activeField, value)
                          }}
                          sx={(theme) => ({
                            minWidth: 0,
                            width: '100%',
                            borderRadius: 0.75,
                            px: 1.25,
                            py: 0.5,
                            cursor: 'pointer',
                            boxSizing: 'border-box',
                            bgcolor: selected
                              ? theme.palette.primary.main
                              : theme.palette.background.paper,
                            color: selected
                              ? theme.palette.primary.contrastText
                              : theme.palette.text.primary,
                            '&:hover, &:focus-visible': {
                              outline: 'none',
                              bgcolor: selected
                                ? theme.palette.primary.dark
                                : theme.palette.action.hover,
                            },
                          })}
                        >
                          <Typography
                            component="span"
                            variant="caption"
                            title={value}
                            sx={{
                              display: 'block',
                              minWidth: 0,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {value}
                          </Typography>
                        </Box>
                      )
                    })
                  ) : (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ px: 0.5, py: 0.75 }}
                    >
                      {t('connections.components.filters.noOptions')}
                    </Typography>
                  )}
                </Box>
              </Box>
            </Box>
          </Paper>
        </Popper>
      </Box>
    </ClickAwayListener>
  )
}
