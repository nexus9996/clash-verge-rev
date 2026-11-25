import {
  AccessTimeRounded,
  ChevronRight,
  NetworkCheckRounded,
  SignalWifi0Bar as SignalNone,
  SortByAlphaRounded,
  SortRounded,
} from '@mui/icons-material'
import {
  Box,
  Button,
  Chip,
  IconButton,
  MenuItem,
  Tooltip,
  Typography,
  alpha,
  useTheme,
} from '@mui/material'
import { useNavigate } from 'react-router'
import { useLockFn } from 'ahooks'
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'

import { EnhancedCard } from '@/components/home/enhanced-card'
import type { ProxySortType } from '@/components/proxy/use-filter-sort'
import {
  HOME_PROXY_VIEW_REFETCH_MS,
  useAppRefreshers,
  useClashConfigData,
  useCoreDataStatus,
  useProxiesData,
  useRulesData,
} from '@/hooks/data'
import { useMemberDelay } from '@/hooks/use-group-delays'
import { useProfiles } from '@/hooks/use-profiles'
import { useProxySelection } from '@/hooks/use-proxy-selection'
import { useVerge } from '@/hooks/use-verge'
import delayManager from '@/services/delay'
import {
  getRecord,
  isInteractableMember,
  memberDetails,
  resolveMember,
  type ProxyGroupView,
} from '@/types/proxy-view'
import { debugLog } from '@/utils/debug'

import {
  AUTO_CHECK_DEFAULT_INTERVAL_MINUTES,
  AUTO_CHECK_INITIAL_DELAY_MS,
  type ChainLevel,
  ENTRY_SELECT,
  levelSelect,
  resolveChain,
  type RuleEntry,
  SELECTABLE_GROUP_TYPES,
  STORAGE_KEY_GROUP,
  STORAGE_KEY_SORT_TYPE,
} from './current-proxy-card-model'
import {
  PersistentProxySelect,
  PersistentSelect,
} from './current-proxy-card-select'
import { convertDelayColor, getSignalIcon } from './current-proxy-card-signal'

export const CurrentProxyCard = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const theme = useTheme()
  const { proxyView } = useProxiesData(HOME_PROXY_VIEW_REFETCH_MS)
  const { rules } = useRulesData()
  const { clashConfig } = useClashConfigData()
  const { refreshProxy } = useAppRefreshers()
  const { isCoreDataPending } = useCoreDataStatus()
  const { verge } = useVerge()
  const { current: currentProfile } = useProfiles()
  const autoDelayEnabled = verge?.enable_auto_delay_detection ?? false
  const defaultLatencyTimeout = verge?.default_latency_timeout
  const autoDelayIntervalMs = useMemo(() => {
    const rawInterval = verge?.auto_delay_detection_interval_minutes
    const intervalMinutes =
      typeof rawInterval === 'number' && rawInterval > 0
        ? rawInterval
        : AUTO_CHECK_DEFAULT_INTERVAL_MINUTES
    return Math.max(1, Math.round(intervalMinutes)) * 60 * 1000
  }, [verge?.auto_delay_detection_interval_minutes])
  const currentProfileId = currentProfile?.uid || null

  const getProfileStorageKey = useCallback(
    (baseKey: string) =>
      currentProfileId ? `${baseKey}:${currentProfileId}` : baseKey,
    [currentProfileId],
  )

  const readProfileScopedItem = useCallback(
    (baseKey: string) => {
      if (typeof window === 'undefined') return null
      const profileKey = getProfileStorageKey(baseKey)
      const profileValue = localStorage.getItem(profileKey)
      if (profileValue != null) {
        return profileValue
      }

      return profileKey !== baseKey ? localStorage.getItem(baseKey) : null
    },
    [getProfileStorageKey],
  )

  // Hand the pre-profile-scoping group key to the first profile that shows the card.
  useEffect(() => {
    const profileKey = getProfileStorageKey(STORAGE_KEY_GROUP)
    if (profileKey === STORAGE_KEY_GROUP) return
    if (localStorage.getItem(profileKey) != null) return
    const legacyValue = localStorage.getItem(STORAGE_KEY_GROUP)
    if (legacyValue == null) return
    localStorage.removeItem(STORAGE_KEY_GROUP)
    localStorage.setItem(profileKey, legacyValue)
  }, [getProfileStorageKey])

  const writeProfileScopedItem = useCallback(
    (baseKey: string, value: string) => {
      if (typeof window === 'undefined') return
      const profileKey = getProfileStorageKey(baseKey)
      localStorage.setItem(profileKey, value)
      if (profileKey !== baseKey) {
        localStorage.removeItem(baseKey)
      }
    },
    [getProfileStorageKey],
  )

  const onSelectionError = useCallback(
    (error: unknown) => {
      console.error('代理切换失败', error)
      refreshProxy()
    },
    [refreshProxy],
  )
  const { select } = useProxySelection({ onError: onSelectionError })

  const mode = clashConfig?.mode?.toLowerCase() || 'rule'
  const isGlobalMode = mode === 'global'
  const isDirectMode = mode === 'direct'

  const [sortType, setSortType] = useState<ProxySortType>(() => {
    const savedSortType = localStorage.getItem(STORAGE_KEY_SORT_TYPE)
    return savedSortType ? (Number(savedSortType) as ProxySortType) : 0
  })

  const [pickedGroupName, setPickedGroupName] = useState('')
  const [openSelect, setOpenSelect] = useState<string | null>(null)
  const [openSelectMode, setOpenSelectMode] = useState(mode)
  if (openSelectMode !== mode) {
    setOpenSelectMode(mode)
    setOpenSelect(null)
  }

  const delayButtonRef = useRef<HTMLButtonElement>(null)

  const autoCheckInProgressRef = useRef(false)

  const entries = useMemo<RuleEntry[]>(() => {
    if (!proxyView) return []
    const isSelectable = (group: ProxyGroupView) =>
      !group.hidden && SELECTABLE_GROUP_TYPES.includes(group.type)
    const ruleCounts = new Map<string, number>()
    for (const { proxy } of rules) {
      ruleCounts.set(proxy, (ruleCounts.get(proxy) ?? 0) + 1)
    }
    const matchTarget = rules.find(({ type }) => type === 'Match')?.proxy
    // The view keeps GLOBAL out of `groups`, yet rules may name it.
    const ruleEntries = [
      ...proxyView.groups,
      ...(proxyView.global ? [proxyView.global] : []),
    ]
      .filter(isSelectable)
      .flatMap((group) => {
        const ruleCount = ruleCounts.get(group.name)
        return ruleCount
          ? [{ group, ruleCount, isDefault: group.name === matchTarget }]
          : []
      })
    // Rules that failed to load, or that name no selectable group, leave nothing to anchor on.
    return ruleEntries.length > 0
      ? ruleEntries
      : proxyView.groups.filter(isSelectable).map((group) => ({
          group,
          ruleCount: 0,
          isDefault: false,
        }))
  }, [proxyView, rules])

  const selectedGroupName = useMemo(() => {
    if (isDirectMode) return 'DIRECT'
    if (!proxyView) return ''
    if (isGlobalMode) return proxyView.global?.name ?? 'GLOBAL'

    const hasEntry = (name: string | null) =>
      !!name && entries.some(({ group }) => group.name === name)
    if (hasEntry(pickedGroupName)) return pickedGroupName
    const savedGroup = readProfileScopedItem(STORAGE_KEY_GROUP)
    if (hasEntry(savedGroup)) return savedGroup!

    const defaultEntry =
      entries.find(({ isDefault }) => isDefault) ??
      entries.reduce<RuleEntry | undefined>(
        (most, entry) =>
          most && most.ruleCount >= entry.ruleCount ? most : entry,
        undefined,
      )
    return defaultEntry?.group.name ?? ''
  }, [
    entries,
    isDirectMode,
    isGlobalMode,
    pickedGroupName,
    proxyView,
    readProfileScopedItem,
  ])

  const selectedEntry =
    isGlobalMode || isDirectMode
      ? undefined
      : entries.find(({ group }) => group.name === selectedGroupName)
  const selectedGroup = isGlobalMode ? proxyView?.global : selectedEntry?.group

  const levels = useMemo<ChainLevel[]>(() => {
    if (!proxyView) return []
    if (isDirectMode) {
      const node =
        proxyView.direct == null
          ? undefined
          : getRecord(proxyView, proxyView.direct)
      return node
        ? [
            {
              group: { name: 'DIRECT', members: [] },
              current: {
                memberIndex: 0,
                member: {
                  kind: 'node',
                  ref: {
                    kind: 'node',
                    name: node.name,
                    recordId: node.recordId,
                  },
                  node,
                },
              },
            },
          ]
        : []
    }
    return selectedGroup ? resolveChain(proxyView, selectedGroup) : []
  }, [isDirectMode, proxyView, selectedGroup])
  // A chain deeper than two groups shares one row above the node list so the card stays three rows tall.
  const levelRows =
    levels.length > 2
      ? [levels.slice(0, -1), levels.slice(-1)]
      : levels.map((level) => [level])
  const leafLevel = levels.at(-1)
  const leafGroupName = leafLevel?.group.name ?? ''

  const handleGroupChange = useCallback(
    (newGroupName: string) => {
      if (isGlobalMode || isDirectMode) return
      setPickedGroupName(newGroupName)
      writeProfileScopedItem(STORAGE_KEY_GROUP, newGroupName)
    },
    [isDirectMode, isGlobalMode, writeProfileScopedItem],
  )

  const goToProxies = useCallback(() => {
    void navigate('/proxies')
  }, [navigate])

  const currentMember = leafLevel?.current?.member
  const currentProxy = currentMember ? memberDetails(currentMember) : undefined
  const selectedProxyName = currentMember?.ref.name ?? ''

  const currentDelay = useMemberDelay(
    leafGroupName,
    currentMember,
    false,
  ) as number

  const signalInfo =
    currentProxy && selectedGroupName
      ? getSignalIcon(currentDelay, t)
      : {
          icon: <SignalNone />,
          text: t('home.components.currentProxy.status.uninitialized'),
          color: 'text.secondary',
        }

  const checkCurrentProxyDelay = useEffectEvent(async () => {
    if (autoCheckInProgressRef.current) return
    if (isDirectMode) return

    const groupName = leafGroupName
    const proxyName = selectedProxyName
    const proxyMember = currentMember

    if (!groupName || !proxyMember) return

    autoCheckInProgressRef.current = true

    const timeout = verge?.default_latency_timeout || 10000

    try {
      debugLog(
        `[CurrentProxyCard] 自动检测当前节点延迟，组: ${groupName}, 节点: ${proxyName}`,
      )
      await delayManager.checkDelay(proxyMember, groupName, timeout)
    } catch (error) {
      console.error(
        `[CurrentProxyCard] 自动检测当前节点延迟失败，组: ${groupName}, 节点: ${proxyName}`,
        error,
      )
    } finally {
      autoCheckInProgressRef.current = false
    }
  })

  useEffect(() => {
    if (isDirectMode) return
    if (!autoDelayEnabled) return
    if (!leafGroupName || !selectedProxyName) return

    let disposed = false
    let intervalTimer: ReturnType<typeof setTimeout> | null = null
    let initialTimer: ReturnType<typeof setTimeout> | null = null

    const runAndSchedule = async () => {
      if (disposed) return
      await checkCurrentProxyDelay()
      if (disposed) return
      intervalTimer = setTimeout(runAndSchedule, autoDelayIntervalMs)
    }

    initialTimer = setTimeout(async () => {
      await checkCurrentProxyDelay()
      if (disposed) return
      intervalTimer = setTimeout(runAndSchedule, autoDelayIntervalMs)
    }, AUTO_CHECK_INITIAL_DELAY_MS)

    return () => {
      disposed = true
      if (initialTimer) clearTimeout(initialTimer)
      if (intervalTimer) clearTimeout(intervalTimer)
    }
  }, [
    autoDelayIntervalMs,
    isDirectMode,
    leafGroupName,
    selectedProxyName,
    autoDelayEnabled,
  ])

  const handleSortTypeChange = useCallback(() => {
    const newSortType = ((sortType + 1) % 3) as ProxySortType
    setSortType(newSortType)
    localStorage.setItem(STORAGE_KEY_SORT_TYPE, newSortType.toString())
  }, [sortType])

  // The button keeps an open list open, so it tests the list being looked at.
  const delayLevel =
    levels.find(({ group }) => openSelect === levelSelect(group.name)) ??
    leafLevel

  const handleCheckDelay = useLockFn(async () => {
    if (!proxyView || !delayLevel || isDirectMode) return
    const groupName = delayLevel.group.name

    debugLog(`[CurrentProxyCard] 开始测试所有延迟，组: ${groupName}`)

    const timeout = verge?.default_latency_timeout || 10000

    const interactable = delayLevel.group.members
      .map((member) => resolveMember(proxyView, member))
      .filter(isInteractableMember)
      .filter(({ ref }) => ref.name !== 'DIRECT' && ref.name !== 'REJECT')

    if (interactable.length > 0) {
      const url = delayManager.getUrl(groupName)
      debugLog(`[CurrentProxyCard] 测试URL: ${url}, 超时: ${timeout}ms`)

      try {
        await delayManager.checkListDelay(interactable, groupName, timeout)
        debugLog(`[CurrentProxyCard] 延迟测试完成，组: ${groupName}`)
      } catch (error) {
        console.error(
          `[CurrentProxyCard] 延迟测试出错，组: ${groupName}`,
          error,
        )
      }
    }

    refreshProxy()
  })

  const entrySummary = ({ ruleCount, isDefault }: RuleEntry) => {
    const count = t('home.components.currentProxy.labels.ruleCount', {
      count: ruleCount,
    })
    return isDefault
      ? `${t('home.components.currentProxy.labels.defaultRoute')} · ${count}`
      : count
  }

  const getSortIcon = (): React.ReactElement => {
    switch (sortType) {
      case 1:
        return <AccessTimeRounded fontSize="small" />
      case 2:
        return <SortByAlphaRounded fontSize="small" />
      default:
        return <SortRounded fontSize="small" />
    }
  }

  const getSortTooltip = (): string => {
    switch (sortType) {
      case 0:
        return t('proxies.page.tooltips.sortDefault')
      case 1:
        return t('proxies.page.tooltips.sortDelay')
      case 2:
        return t('proxies.page.tooltips.sortName')
      default:
        return ''
    }
  }

  return (
    <EnhancedCard
      title={t('home.components.currentProxy.title')}
      icon={
        <Tooltip
          title={
            currentProxy
              ? `${signalInfo.text}: ${delayManager.formatDelay(currentDelay)}`
              : t('home.components.currentProxy.status.noProxyNode')
          }
        >
          <Box sx={{ color: signalInfo.color }}>
            {currentProxy ? signalInfo.icon : <SignalNone color="disabled" />}
          </Box>
        </Tooltip>
      }
      iconColor={currentProxy ? 'primary' : undefined}
      action={
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Tooltip
            title={t('home.components.currentProxy.actions.refreshDelay')}
          >
            <span>
              <IconButton
                ref={delayButtonRef}
                size="small"
                color="inherit"
                onClick={handleCheckDelay}
                disabled={isDirectMode || !delayLevel?.group.members.length}
                aria-label={t(
                  'home.components.currentProxy.actions.refreshDelay',
                )}
              >
                <NetworkCheckRounded />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title={getSortTooltip()}>
            <IconButton
              size="small"
              color="inherit"
              onClick={handleSortTypeChange}
            >
              {getSortIcon()}
            </IconButton>
          </Tooltip>
          <Button
            variant="outlined"
            size="small"
            onClick={goToProxies}
            sx={{ borderRadius: 1.5 }}
            endIcon={<ChevronRight fontSize="small" />}
          >
            {t('layout.components.navigation.tabs.proxies')}
          </Button>
        </Box>
      }
    >
      {isCoreDataPending ? (
        <Box sx={{ py: 4, height: 24 }} />
      ) : currentProxy || (!isDirectMode && selectedGroup) ? (
        <Box>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              p: 1,
              mb: 2,
              borderRadius: 1,
              bgcolor: alpha(theme.palette.primary.main, 0.05),
              border: `1px solid ${alpha(theme.palette.primary.main, 0.1)}`,
            }}
          >
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography
                variant="body1"
                noWrap
                title={currentProxy?.name}
                sx={{ fontWeight: 'medium' }}
              >
                {currentProxy?.name ??
                  t('home.components.currentProxy.labels.noActiveNode')}
              </Typography>

              <Box
                sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}
              >
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ mr: 1 }}
                >
                  {currentProxy?.type}
                </Typography>
                {isGlobalMode && (
                  <Chip
                    size="small"
                    label={t('home.components.currentProxy.labels.globalMode')}
                    color="primary"
                    sx={{ mr: 0.5 }}
                  />
                )}
                {isDirectMode && (
                  <Chip
                    size="small"
                    label={t('home.components.currentProxy.labels.directMode')}
                    color="success"
                    sx={{ mr: 0.5 }}
                  />
                )}
                {currentProxy?.udp && (
                  <Chip size="small" label="UDP" variant="outlined" />
                )}
                {currentProxy?.tfo && (
                  <Chip size="small" label="TFO" variant="outlined" />
                )}
                {currentProxy?.xudp && (
                  <Chip size="small" label="XUDP" variant="outlined" />
                )}
                {currentProxy?.mptcp && (
                  <Chip size="small" label="MPTCP" variant="outlined" />
                )}
                {currentProxy?.smux && (
                  <Chip size="small" label="SMUX" variant="outlined" />
                )}
              </Box>
            </Box>

            {currentProxy && !isDirectMode && (
              <Chip
                size="small"
                label={delayManager.formatDelay(currentDelay)}
                color={convertDelayColor(currentDelay)}
                sx={{ flexShrink: 0, ml: 1 }}
              />
            )}
          </Box>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <PersistentSelect
              label={t(
                selectedEntry?.ruleCount
                  ? 'home.components.currentProxy.labels.ruleTarget'
                  : 'home.components.currentProxy.labels.group',
              )}
              displayValue={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography noWrap sx={{ minWidth: 0, flex: 1 }}>
                    {selectedGroupName}
                  </Typography>
                  {!!selectedEntry?.ruleCount && (
                    <Typography
                      variant="caption"
                      sx={{ flexShrink: 0, color: 'text.secondary' }}
                    >
                      {entrySummary(selectedEntry)}
                    </Typography>
                  )}
                </Box>
              }
              open={openSelect === ENTRY_SELECT}
              disabled={isGlobalMode || isDirectMode}
              keepOpenRef={delayButtonRef}
              onOpenChange={(open) => setOpenSelect(open ? ENTRY_SELECT : null)}
              renderOptions={() =>
                entries.map((entry) => {
                  const { group, ruleCount } = entry
                  const activeName = resolveChain(proxyView!, group).at(-1)
                    ?.current?.member.ref.name
                  return (
                    <MenuItem
                      key={group.name}
                      role="option"
                      aria-selected={group.name === selectedGroupName}
                      selected={group.name === selectedGroupName}
                      onClick={() => handleGroupChange(group.name)}
                      sx={{ gap: 1 }}
                    >
                      <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Typography noWrap>{group.name}</Typography>
                        {activeName && (
                          <Typography
                            noWrap
                            component="div"
                            variant="caption"
                            sx={{ color: 'text.secondary' }}
                          >
                            → {activeName}
                          </Typography>
                        )}
                      </Box>
                      {ruleCount > 0 && (
                        <Typography
                          variant="caption"
                          sx={{ flexShrink: 0, color: 'text.secondary' }}
                        >
                          {entrySummary(entry)}
                        </Typography>
                      )}
                    </MenuItem>
                  )
                })
              }
            />
            {levelRows.map((row) => (
              <Box key={row[0].group.name} sx={{ display: 'flex', gap: 1 }}>
                {row.map((level) => (
                  <Box key={level.group.name} sx={{ minWidth: 0, flex: 1 }}>
                    <PersistentProxySelect
                      label={t(
                        level === leafLevel
                          ? 'home.components.currentProxy.labels.proxy'
                          : 'home.components.currentProxy.labels.group',
                      )}
                      view={proxyView!}
                      level={level}
                      sortType={sortType}
                      latencyTimeout={defaultLatencyTimeout ?? undefined}
                      open={openSelect === levelSelect(level.group.name)}
                      disabled={isDirectMode}
                      keepOpenRef={delayButtonRef}
                      onOpenChange={(open) =>
                        setOpenSelect(
                          open ? levelSelect(level.group.name) : null,
                        )
                      }
                      onChange={select}
                    />
                  </Box>
                ))}
              </Box>
            ))}
          </Box>
        </Box>
      ) : (
        <Box sx={{ textAlign: 'center', py: 4 }}>
          <Typography
            sx={{ height: 24 }}
            variant="body1"
            color="text.secondary"
          >
            {t('home.components.currentProxy.labels.noActiveNode')}
          </Typography>
        </Box>
      )}
    </EnhancedCard>
  )
}
