import { Box } from '@mui/material'
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'

import { BaseEmpty, BasePage } from '@/components/base'
import {
  VirtualList,
  type VirtualListHandle,
} from '@/components/base/virtual-list'
import { ScrollTopButton } from '@/components/layout/scroll-top-button'
import { ProviderButton } from '@/components/rule/provider-button'
import RuleItem from '@/components/rule/rule-item'
import { RuleSearchBox } from '@/components/rule/rule-search-box'
import { useAppRefreshers, useRulesData } from '@/hooks/data'
import { useVisibility } from '@/hooks/use-visibility'
import {
  getRulesExtra,
  updateRulesDisable,
  type RuleExtraInfo,
} from '@/services/cmds'
import { mutate } from '@/services/mutate'
import { mergeRuleExtras } from '@/utils/rule-extras'
import {
  EMPTY_RULE_SEARCH,
  type RuleSearchState,
  createRuleSearchMatcher,
} from '@/utils/rule-search'

// Hit counts are secondary information; refresh often enough to stay useful
const HIT_REFRESH_INTERVAL_MS = 15000

const RulesPage = () => {
  const { t } = useTranslation()
  const { rules = [] } = useRulesData()
  const { refreshRules, refreshRuleProviders } = useAppRefreshers()
  const [search, setSearch] = useState<RuleSearchState>(EMPTY_RULE_SEARCH)
  const [ruleExtras, setRuleExtras] = useState<
    ReadonlyMap<number, RuleExtraInfo>
  >(() => new Map())
  const [pendingRuleIndexes, setPendingRuleIndexes] = useState<
    ReadonlySet<number>
  >(() => new Set())
  const virtuosoRef = useRef<VirtualListHandle>(null)
  const [showScrollTop, setShowScrollTop] = useState(false)
  const pageVisible = useVisibility()

  // 页面可见时刷新规则数据：挂载时可见或从隐藏恢复可见各触发一次
  useEffect(() => {
    if (pageVisible) {
      refreshRules()
      refreshRuleProviders()
    }
  }, [refreshRules, refreshRuleProviders, pageVisible])

  // Defer only the filter derivation: input state stays immediate, while a
  // burst of keystrokes cannot block the render with a full rules scan.
  const deferredSearch = useDeferredValue(search)
  const searchMatcher = useMemo(
    () => createRuleSearchMatcher(deferredSearch),
    [deferredSearch],
  )

  const refreshExtras = useCallback(async () => {
    try {
      const extras = await getRulesExtra()
      setRuleExtras((previous) => mergeRuleExtras(previous, extras))
    } catch (error) {
      console.warn('Failed to load rule hit information', error)
    }
  }, [])

  useEffect(() => {
    if (!pageVisible) return
    void refreshExtras()
    const timer = window.setInterval(
      () => void refreshExtras(),
      HIT_REFRESH_INTERVAL_MS,
    )
    return () => window.clearInterval(timer)
  }, [pageVisible, refreshExtras])

  const handleToggleRule = useCallback(
    async (index: number, disabled: boolean) => {
      setPendingRuleIndexes((prev) => new Set(prev).add(index))
      try {
        await mutate(() => updateRulesDisable([{ index, disabled }]), {
          id: `rule-disable-${index}`,
        })
        await refreshExtras()
      } catch (error) {
        console.error('Failed to update rule state', error)
      } finally {
        setPendingRuleIndexes((prev) => {
          const next = new Set(prev)
          next.delete(index)
          return next
        })
      }
    },
    [refreshExtras],
  )

  // Only original indexes are collected, so a keystroke no longer clones ~12k
  // rule objects; lineNo and all lookups fall out of the index when rendering.
  const visibleIndexes = useMemo(() => {
    const indexes: number[] = []
    for (let index = 0; index < rules.length; index += 1) {
      const rule = rules[index]
      if (searchMatcher(rule, rule.payload ?? '')) indexes.push(index)
    }
    return indexes
  }, [rules, searchMatcher])

  const getItemKey = useCallback(
    (index: number) => rules[visibleIndexes[index]]?.index ?? index,
    [rules, visibleIndexes],
  )

  const handleScroll = useCallback((e: Event) => {
    setShowScrollTop((e.target as HTMLElement).scrollTop > 100)
  }, [])

  const scrollToTop = () => {
    virtuosoRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <BasePage
      full
      title={t('rules.page.title')}
      contentStyle={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'auto',
      }}
      header={
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <ProviderButton />
        </Box>
      }
    >
      <Box
        sx={{
          pt: 1,
          mb: 0.5,
          mx: '10px',
          height: '36px',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <RuleSearchBox onSearch={setSearch} />
      </Box>

      {visibleIndexes.length > 0 ? (
        <>
          <VirtualList
            ref={virtuosoRef}
            count={visibleIndexes.length}
            estimateSize={40}
            getItemKey={getItemKey}
            renderItem={(i) => {
              const ruleIndex = visibleIndexes[i]
              const rule = rules[ruleIndex]
              return (
                <RuleItem
                  value={rule}
                  lineNo={ruleIndex + 1}
                  extra={ruleExtras.get(rule.index)}
                  pending={pendingRuleIndexes.has(rule.index)}
                  onToggleDisabled={handleToggleRule}
                />
              )
            }}
            style={{ flex: 1 }}
            onScroll={handleScroll}
          />
          <ScrollTopButton onClick={scrollToTop} show={showScrollTop} />
        </>
      ) : (
        <BaseEmpty />
      )}
    </BasePage>
  )
}

export default RulesPage
