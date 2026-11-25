import { ArrowDropDown } from '@mui/icons-material'
import {
  Box,
  ButtonBase,
  Chip,
  ClickAwayListener,
  MenuItem,
  MenuList,
  Paper,
  Popper,
  type PopperProps,
  Typography,
  alpha,
} from '@mui/material'
import { memo, useCallback, useEffect, useId, useMemo, useRef } from 'react'

import type { ProxySortType } from '@/components/proxy/use-filter-sort'
import { useMemberDelay } from '@/hooks/use-group-delays'
import delayManager from '@/services/delay'
import type { ProxyViewV1 } from '@/types/proxy-view'

import {
  buildProxyOptions,
  type ChainLevel,
  optionValue,
  type ProxyOption,
  proxyMenuModifiers,
} from './current-proxy-card-model'
import { convertDelayColor } from './current-proxy-card-signal'

const PROXY_MENU_MAX_HEIGHT = 500

export interface PersistentSelectProps {
  label: string
  displayValue: React.ReactNode
  open: boolean
  disabled: boolean
  keepOpenRef: React.RefObject<HTMLElement | null>
  onOpenChange: (open: boolean) => void
  renderOptions: () => React.ReactNode
}

export const PersistentSelect = ({
  label,
  displayValue,
  open,
  disabled,
  keepOpenRef,
  onOpenChange,
  renderOptions,
}: PersistentSelectProps) => {
  const id = useId()
  const labelId = `${id}-label`
  const valueId = `${id}-value`
  const listboxId = `${id}-listbox`
  const anchorRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const popperOptions = useMemo<PopperProps['popperOptions']>(
    () => ({
      onFirstUpdate: () => {
        const list = listRef.current
        const paper = list?.parentElement
        const item =
          list?.querySelector<HTMLElement>(
            '[aria-selected="true"]:not([aria-disabled="true"])',
          ) ??
          list?.querySelector<HTMLElement>(
            '[role="option"]:not([aria-disabled="true"])',
          )
        if (!item || !paper) return

        // Focusing before positioning can scroll the page instead of just the menu.
        item.focus({ preventScroll: true })
        paper.scrollTop +=
          item.getBoundingClientRect().top -
          paper.getBoundingClientRect().top -
          (paper.clientHeight - item.offsetHeight) / 2
      },
    }),
    [],
  )

  useEffect(() => {
    if (!open) return

    const closeFromKeyboard = (event: KeyboardEvent) => {
      if (event.key === 'Tab') {
        onOpenChange(false)
      } else if (event.key === 'Escape') {
        onOpenChange(false)
        anchorRef.current?.focus({ preventScroll: true })
      }
    }
    document.addEventListener('keydown', closeFromKeyboard)
    return () => document.removeEventListener('keydown', closeFromKeyboard)
  }, [onOpenChange, open])

  return (
    <ClickAwayListener
      onClickAway={(event) => {
        if (!open) return
        const target = event.target
        if (target instanceof Node && keepOpenRef.current?.contains(target)) {
          return
        }
        onOpenChange(false)
      }}
    >
      <Box>
        <Box
          sx={{
            position: 'relative',
            borderRadius: 1,
            '& fieldset': {
              borderColor: (theme) =>
                alpha(theme.palette.text.primary, disabled ? 0.12 : 0.23),
            },
            ...(!disabled && {
              '&:hover fieldset': { borderColor: 'text.primary' },
              '&:focus-within fieldset': {
                borderColor: 'primary.main',
                borderWidth: 2,
              },
              '&:focus-within legend': { color: 'primary.main' },
            }),
          }}
        >
          <ButtonBase
            ref={anchorRef}
            type="button"
            role="combobox"
            aria-labelledby={`${labelId} ${valueId}`}
            aria-haspopup="listbox"
            aria-controls={open ? listboxId : undefined}
            aria-expanded={open}
            disabled={disabled}
            onClick={() => onOpenChange(!open)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault()
                onOpenChange(true)
              }
            }}
            sx={{
              width: '100%',
              height: 40,
              px: 1.75,
              borderRadius: 'inherit',
              justifyContent: 'space-between',
              textAlign: 'left',
              color: disabled ? 'text.disabled' : 'text.primary',
            }}
          >
            <Box id={valueId} sx={{ minWidth: 0, flex: 1 }}>
              {displayValue}
            </Box>
            <ArrowDropDown
              sx={{
                ml: 1,
                color: disabled ? 'action.disabled' : 'action.active',
                transform: open ? 'rotate(180deg)' : undefined,
              }}
            />
          </ButtonBase>
          <Box
            component="fieldset"
            sx={{
              position: 'absolute',
              inset: '-5px 0 0',
              m: 0,
              px: 1,
              minWidth: 0,
              border: '1px solid',
              borderRadius: 'inherit',
              pointerEvents: 'none',
            }}
          >
            <Box
              component="legend"
              id={labelId}
              sx={{
                px: 0.5,
                typography: 'caption',
                lineHeight: '11px',
                color: disabled ? 'text.disabled' : 'text.secondary',
              }}
            >
              {label}
            </Box>
          </Box>
        </Box>

        <Popper
          open={open}
          anchorEl={anchorRef.current}
          placement="bottom-start"
          modifiers={proxyMenuModifiers}
          popperOptions={popperOptions}
          sx={{
            visibility: 'hidden',
            zIndex: (theme) => theme.zIndex.modal,
          }}
        >
          <Paper
            elevation={8}
            sx={{
              maxHeight: `var(--proxy-menu-max-height, ${PROXY_MENU_MAX_HEIGHT}px)`,
              overflow: 'auto',
            }}
          >
            <MenuList
              ref={listRef}
              id={listboxId}
              role="listbox"
              aria-labelledby={labelId}
              variant="selectedMenu"
              onClick={(event) => {
                // A disabled option passes its click to the list itself.
                if (!(event.target as Element).closest('[role="option"]'))
                  return
                onOpenChange(false)
                anchorRef.current?.focus({ preventScroll: true })
              }}
            >
              {open && renderOptions()}
            </MenuList>
          </Paper>
        </Popper>
      </Box>
    </ClickAwayListener>
  )
}
interface PersistentProxySelectProps extends Omit<
  PersistentSelectProps,
  'displayValue' | 'renderOptions'
> {
  view: ProxyViewV1
  level: ChainLevel
  sortType: ProxySortType
  latencyTimeout?: number
  onChange: (groupName: string, proxyName: string, fixed?: string) => void
}

const ProxyMenuOption = memo(function ProxyMenuOption({
  option,
  selected,
  isFixed,
  fixedProxyInUsed,
  delay,
  onChange,
}: {
  option: ProxyOption
  selected: boolean
  isFixed: boolean
  fixedProxyInUsed: boolean
  delay: number
  onChange: (proxyName: string) => void
}) {
  return (
    <MenuItem
      role="option"
      aria-selected={selected}
      selected={selected}
      disabled={option.disabled}
      onClick={() => {
        if (!option.disabled) onChange(option.name)
      }}
      sx={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        width: '100%',
        pr: 1,
      }}
    >
      {isFixed && (
        <span
          style={{
            position: 'absolute',
            fontSize: '12px',
            top: '-5px',
            right: '5px',
            ...(!fixedProxyInUsed && {
              filter: 'grayscale(1)',
            }),
          }}
        >
          📌
        </span>
      )}
      <Typography noWrap sx={{ flex: 1, mr: 1 }}>
        {option.name}
      </Typography>
      {!option.disabled && (
        <Chip
          size="small"
          label={delayManager.formatDelay(delay)}
          color={convertDelayColor(delay)}
          sx={{
            minWidth: '60px',
            height: '22px',
            flexShrink: 0,
          }}
        />
      )}
    </MenuItem>
  )
})

export const PersistentProxySelect = ({
  view,
  level: { group, current },
  sortType,
  latencyTimeout,
  onChange,
  ...props
}: PersistentProxySelectProps) => {
  const groupName = group.name
  const fixed = group.fixed
  const selectedName = current?.member.ref.name ?? ''
  const value = current ? optionValue(current.memberIndex, current.member) : ''
  const fixedProxyInUsed = selectedName === fixed

  const delays = useMemberDelay(groupName, current?.member, props.open)
  const selectedDelay =
    typeof delays === 'number'
      ? delays
      : current
        ? delays.of(current.member)
        : -1

  const options = useMemo(() => {
    if (typeof delays === 'number') return []
    return buildProxyOptions(view, group, sortType, delays.of, latencyTimeout)
  }, [delays, group, latencyTimeout, sortType, view])

  const handleChange = useCallback(
    (proxyName: string) => onChange(groupName, proxyName, fixed),
    [fixed, groupName, onChange],
  )

  return (
    <PersistentSelect
      {...props}
      displayValue={
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <Typography noWrap>{selectedName}</Typography>
          <Chip
            size="small"
            label={delayManager.formatDelay(selectedDelay)}
            color={convertDelayColor(selectedDelay)}
          />
          {fixedProxyInUsed && (
            <span
              style={{
                position: 'absolute',
                fontSize: '12px',
                top: '-3px',
                right: '25px',
              }}
            >
              📌
            </span>
          )}
        </Box>
      }
      renderOptions={() =>
        options.map((option) => {
          const selected = option.value === value
          const isFixed = option.name === fixed
          const delay = option.disabled
            ? -1
            : delayManager.getDelayFix(option.member, groupName)

          return (
            <ProxyMenuOption
              key={option.value}
              option={option}
              selected={selected}
              isFixed={isFixed}
              fixedProxyInUsed={fixedProxyInUsed}
              delay={delay}
              onChange={handleChange}
            />
          )
        })
      }
    />
  )
}
