import { Box } from '@mui/material'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  BaseEmpty,
  BasePage,
  VirtualList,
  type VirtualListHandle,
} from '@/components/base'
import { ScrollTopButton } from '@/components/layout/scroll-top-button'
import { ProviderButton } from '@/components/rule/provider-button'
import RuleItem from '@/components/rule/rule-item'
import { RuleSearchBox } from '@/components/rule/rule-search-box'
import { useVisibility } from '@/hooks/use-visibility'
import { useAppRefreshers, useRulesData } from '@/providers/app-data-context'
import {
  getRulesExtra,
  updateRulesDisable,
  type RuleExtraInfo,
} from '@/services/cmds'
import { mutate } from '@/services/mutate'
import {
  EMPTY_RULE_SEARCH,
  type RuleSearchState,
  createRuleSearchMatcher,
} from '@/utils/rule-search'

const HIT_REFRESH_INTERVAL_MS = 5000

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

  // 在组件挂载时和页面获得焦点时刷新规则数据
  useEffect(() => {
    refreshRules()
    refreshRuleProviders()

    if (pageVisible) {
      refreshRules()
      refreshRuleProviders()
    }
  }, [refreshRules, refreshRuleProviders, pageVisible])

  const searchMatcher = useMemo(() => createRuleSearchMatcher(search), [search])

  const refreshExtras = useCallback(async () => {
    try {
      const extras = await getRulesExtra()
      setRuleExtras(new Map(extras.map((extra) => [extra.index, extra])))
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

  const filteredRules = useMemo(() => {
    const rulesWithLineNo = rules.map((item, index) => ({
      ...item,
      // UI-only derived data; keep app context/SWR data immutable
      lineNo: index + 1,
    }))

    return rulesWithLineNo.filter((item) =>
      searchMatcher(item, item.payload ?? ''),
    )
  }, [rules, searchMatcher])

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

      {filteredRules && filteredRules.length > 0 ? (
        <>
          <VirtualList
            ref={virtuosoRef}
            count={filteredRules.length}
            estimateSize={40}
            renderItem={(i) => {
              const rule = filteredRules[i]
              return (
                <RuleItem
                  value={rule}
                  extra={ruleExtras.get(rule.index)}
                  pending={pendingRuleIndexes.has(rule.index)}
                  onToggleDisabled={(disabled) =>
                    void handleToggleRule(rule.index, disabled)
                  }
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
