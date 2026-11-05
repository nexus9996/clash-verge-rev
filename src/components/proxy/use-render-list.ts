import { useEffect, useMemo, useRef } from 'react'

import { useAppRefreshers, useProxiesData } from '@/hooks/data'
import { useRuntimeConfig } from '@/hooks/use-clash'
import { useGroupsDelays } from '@/hooks/use-group-delays'
import { useVerge } from '@/hooks/use-verge'
import delayManager, { type DelaySnapshot } from '@/services/delay'
import {
  findCurrentGroupMember,
  isInteractableMember,
  resolveMember,
  selectGlobalChainNodes,
  selectRuleChainMembers,
  type ProxyGroupView,
  type ProxyMemberRef,
  type ProxyNodeView,
  type ProxyViewV1,
  type ResolvedProxyMember,
} from '@/types/proxy-view'
import { debugLog } from '@/utils/debug'

import { filterSort } from './use-filter-sort'
import {
  DEFAULT_STATE,
  useHeadStateNew,
  type HeadState,
} from './use-head-state'
import { useWindowWidth } from './use-window-width'

export interface ResolvedMemberOccurrence {
  memberIndex: number
  member: ResolvedProxyMember
}

type ProxyGroup = ProxyGroupView

export interface IRenderItem {
  type: 0 | 1 | 2 | 3 | 4
  key: string
  group: ProxyGroup
  member?: ResolvedMemberOccurrence
  memberCol?: ResolvedMemberOccurrence[]
  col?: number
  headState?: HeadState
  icon?: string
  testUrl?: string
}

/**
 * Whether the list about to be drawn contains anything a user would call content.
 *
 * Derived from the list itself rather than predicted beside it. The prediction that used to
 * live in the empty-state model asked a different question in chain mode — whether any
 * Selector or URLTest group existed — which is unrelated to what the chain list is actually
 * built from, so both a false "empty" and a false "not empty" were reachable.
 *
 * A group header alone counts only when the group is visible; every other row is content by
 * definition, including the members of a group that is hidden but expanded.
 */
export const hasRenderableItems = (
  renderList: readonly IRenderItem[],
): boolean => renderList.some((item) => item.type !== 0 || !item.group.hidden)

type CachedMember = {
  signature: string
  member: ResolvedProxyMember
}

type GroupSignatures = {
  contentKey: string
  memberSignatures: string[]
}

/** Per-proxyView content signatures; rebuilt only when the view object changes. */
type ViewSignatureCache = {
  view: ProxyViewV1
  nodeSignatures: Map<string, string>
  groups: Map<string, GroupSignatures>
}

type GroupCache = {
  /** Header + member content; replaces array/object identity checks. */
  contentKey: string
  /** Resolved members keyed by ref identity, reused while their content is equal. */
  members: Map<string, CachedMember>
  headState: HeadState
  col: number
  latencyTimeout: number | undefined
  /// This group's own delays. Compared by identity so that a test settling in one group
  /// does not throw away every other group's sorted order.
  delays: DelaySnapshot | undefined
  items: IRenderItem[]
}

type ChainItemRecord = {
  signature: string
  item: IRenderItem
}

type ChainCache = {
  /** Content of the chain group (name/now/etc.) the items embed. */
  groupKey: string
  contentKey: string
  col: number
  members: Map<string, CachedMember>
  /** Per-row items keyed by member identity + occurrence index, for partial reuse. */
  itemsByMember: Map<string, ChainItemRecord>
  items: IRenderItem[]
}

type RuntimeConfigWithProxySequence = IConfigData & { proxies?: unknown }

const delaySignature = (
  history: readonly { time: string; delay: number }[],
) => {
  if (history.length === 0) return 'no-history'
  const latest = history[history.length - 1]
  return `${latest.time}:${latest.delay}`
}

/**
 * Stable description of everything a node row draws (plus the delay fallback that
 * reads its history). A refetch that re-serialises the same node keeps this equal.
 */
const nodeSignature = (node: ProxyNodeView) =>
  [
    node.recordId,
    node.name,
    node.type,
    node.id ?? '',
    node.icon ?? '',
    node.testUrl ?? '',
    node.hidden ?? false,
    node.source.kind,
    node.source.proxyName,
    node.source.kind === 'provider' ? node.source.providerName : '',
    node.udp,
    node.xudp,
    node.tfo,
    node.mptcp,
    node.smux,
    delaySignature(node.history),
  ].join('\u0001')

/** Same idea for groups: header fields, row-visible fields and the history fallback. */
const groupSignature = (group: ProxyGroupView) =>
  [
    group.name,
    group.type,
    group.now ?? '',
    group.fixed ?? '',
    group.hidden ?? false,
    group.icon ?? '',
    group.testUrl ?? '',
    group.udp,
    group.xudp,
    group.tfo,
    group.mptcp,
    group.smux,
    delaySignature(group.history),
  ].join('\u0001')

const memberIdentity = (ref: ProxyMemberRef) =>
  ref.kind === 'node'
    ? `node:${ref.name}:${ref.recordId}`
    : ref.kind === 'group'
      ? `group:${ref.name}`
      : `unresolved:${ref.name}:${ref.reason}`

/** Content of one member ref; only members whose content changed get re-resolved. */
const memberContentSignature = (
  view: ProxyViewV1,
  ref: ProxyMemberRef,
  nodeSignatures: Map<string, string>,
): string => {
  if (ref.kind === 'unresolved') {
    return `unresolved:${ref.name}:${ref.reason}`
  }
  if (ref.kind === 'group') {
    const group =
      view.global?.name === ref.name
        ? view.global
        : view.groups.find(({ name }) => name === ref.name)
    return `group:${ref.name}:${group ? groupSignature(group) : 'missing'}`
  }

  let signature = nodeSignatures.get(ref.recordId)
  if (signature === undefined) {
    const node = view.records[ref.recordId]
    signature = node ? nodeSignature(node) : 'missing'
    nodeSignatures.set(ref.recordId, signature)
  }
  return `node:${ref.name}:${ref.recordId}:${signature}`
}

const resolveOccurrences = (
  view: ProxyViewV1,
  group: ProxyGroupView,
  memberSignatures: readonly string[],
  cachedMembers: ReadonlyMap<string, CachedMember> | undefined,
  nextMembers: Map<string, CachedMember>,
): ResolvedMemberOccurrence[] =>
  group.members.map((ref, memberIndex) => {
    const identity = memberIdentity(ref)
    const signature = memberSignatures[memberIndex] ?? ''
    const cached = cachedMembers?.get(identity)
    const member =
      cached && cached.signature === signature
        ? cached.member
        : resolveMember(view, ref)
    nextMembers.set(identity, { signature, member })
    return { memberIndex, member }
  })

const memberKey = (
  group: ProxyGroupView,
  occurrence: ResolvedMemberOccurrence,
) => {
  const { memberIndex, member } = occurrence
  const identity =
    member.kind === 'node' ? member.node.recordId : member.ref.name
  return `${group.name}:${memberIndex}:${identity}`
}

const calculateColumns = (width: number, configCol: number): number => {
  if (configCol > 0 && configCol < 6) return configCol
  if (width > 1920) return 5
  if (width > 1450) return 4
  if (width > 1024) return 3
  if (width >= 600) return 2
  return 1
}

const groupOccurrences = <T>(list: T[], size: number): T[][] =>
  list.reduce<T[][]>((acc, item) => {
    const lastGroup = acc[acc.length - 1]
    if (!lastGroup || lastGroup.length >= size) acc.push([item])
    else lastGroup.push(item)
    return acc
  }, [])

export const CHAIN_DELAY_GROUP = 'chain-mode'

const virtualGroup = (members: ProxyGroupView['members']): ProxyGroupView => ({
  name: CHAIN_DELAY_GROUP,
  type: 'Selector',
  udp: false,
  xudp: false,
  tfo: false,
  mptcp: false,
  smux: false,
  history: [],
  members,
})

export const useRenderList = (
  mode: string,
  isChainMode?: boolean,
  selectedGroup?: string | null,
) => {
  const { proxyView } = useProxiesData()
  const { refreshProxy } = useAppRefreshers()
  const { verge } = useVerge()
  const { width } = useWindowWidth()
  const [headStates, setHeadState] = useHeadStateNew()
  const latencyTimeout = verge?.default_latency_timeout
  const { data: runtimeConfig } = useRuntimeConfig(!!isChainMode)
  const runtimeProxies = (
    runtimeConfig as RuntimeConfigWithProxySequence | null
  )?.proxies

  const col = useMemo(
    () => calculateColumns(width, verge?.proxy_layout_column || 6),
    [width, verge?.proxy_layout_column],
  )

  const chainOccurrences = useMemo(() => {
    if (!proxyView || !isChainMode) return []
    if (mode === 'rule' && selectedGroup) {
      return selectRuleChainMembers(proxyView, selectedGroup)
    }
    if (!runtimeConfig) return []
    return selectGlobalChainNodes(proxyView, runtimeProxies).map(
      (node, memberIndex) => ({
        memberIndex,
        member: {
          kind: 'node' as const,
          ref: {
            kind: 'node' as const,
            name: node.name,
            recordId: node.recordId,
          },
          node,
        },
      }),
    )
  }, [
    isChainMode,
    mode,
    proxyView,
    runtimeConfig,
    runtimeProxies,
    selectedGroup,
  ])

  const chainOccurrencesRef = useRef(chainOccurrences)
  chainOccurrencesRef.current = chainOccurrences
  const chainDelayGroup =
    mode === 'rule' && selectedGroup ? selectedGroup : CHAIN_DELAY_GROUP
  const chainDelayKey = chainOccurrences
    .map(({ member }) => {
      if (member.kind !== 'node') return `${member.kind}:${member.ref.name}`
      const source = member.node.source
      return source.kind === 'provider'
        ? `provider:${source.providerName}:${source.proxyName}`
        : `core:${source.proxyName}`
    })
    .join('\u0000')

  useEffect(() => {
    if (!isChainMode || !chainDelayKey) return
    const interactable = chainOccurrencesRef.current
      .map(({ member }) => member)
      .filter(isInteractableMember)
    if (interactable.length === 0) return

    const controller = new AbortController()
    const handle = setTimeout(() => {
      const timeout = verge?.default_latency_timeout || 10000
      debugLog(`[ChainMode] 开始计算 ${interactable.length} 个节点的延迟`)
      void delayManager.checkListDelay(
        interactable,
        chainDelayGroup,
        timeout,
        undefined,
        controller.signal,
      )
    }, 100)

    return () => {
      clearTimeout(handle)
      controller.abort()
    }
  }, [
    chainDelayGroup,
    chainDelayKey,
    isChainMode,
    verge?.default_latency_timeout,
  ])

  const renderGroups = useMemo(() => {
    if (!proxyView) return []
    if (mode === 'rule') return proxyView.groups
    const { global } = proxyView
    if (!global) return []
    const current = findCurrentGroupMember(proxyView, global)?.member
    return current?.kind === 'group' ? [global, current.group] : [global]
  }, [mode, proxyView])

  // Every group this list draws, so a test settling in any of them re-sorts that group.
  const renderedGroupNames = useMemo(() => {
    if (!proxyView) return []
    if (isChainMode)
      return selectedGroup ? [selectedGroup] : [CHAIN_DELAY_GROUP]
    return renderGroups.map(({ name }) => name)
  }, [isChainMode, proxyView, renderGroups, selectedGroup])
  const groupDelays = useGroupsDelays(renderedGroupNames)

  const groupCacheRef = useRef<Map<string, GroupCache>>(new Map())
  const chainCacheRef = useRef<ChainCache | null>(null)
  const signatureCacheRef = useRef<ViewSignatureCache | null>(null)
  const prevListRef = useRef<IRenderItem[]>([])

  const renderList = useMemo<IRenderItem[]>(() => {
    if (!proxyView) return []

    // Content signatures serve both list shapes; they are rebuilt only when the
    // view object is replaced.
    const signatureCache =
      signatureCacheRef.current?.view === proxyView
        ? signatureCacheRef.current
        : {
            view: proxyView,
            nodeSignatures: new Map<string, string>(),
            groups: new Map<string, GroupSignatures>(),
          }
    signatureCacheRef.current = signatureCache

    const getMemberSignature = (ref: ProxyMemberRef) =>
      memberContentSignature(proxyView, ref, signatureCache.nodeSignatures)

    if (isChainMode) {
      const selected =
        mode === 'rule'
          ? proxyView.groups.find(({ name }) => name === selectedGroup)
          : undefined
      const group = selected ?? virtualGroup([])
      const groupKey = groupSignature(group)
      const chainEntries = chainOccurrences.map(({ member, memberIndex }) => ({
        identity: memberIdentity(member.ref),
        memberIndex,
        signature: getMemberSignature(member.ref),
        member,
      }))
      const contentKey = [
        groupKey,
        String(col),
        ...chainEntries.map(
          ({ identity, memberIndex, signature }) =>
            `${identity}#${memberIndex}#${signature}`,
        ),
      ].join('\u0000')

      const cached = chainCacheRef.current
      if (cached && cached.contentKey === contentKey) return cached.items

      const groupContentUnchanged = cached?.groupKey === groupKey
      const signaturesByKey = new Map<string, string>()
      for (const entry of chainEntries) {
        signaturesByKey.set(
          `${entry.identity}#${entry.memberIndex}`,
          entry.signature,
        )
      }

      const nextMembers = new Map<string, CachedMember>()
      const nextItemsByMember = new Map<string, ChainItemRecord>()
      const occurrences = filterSort(
        chainEntries.map(({ identity, memberIndex, signature, member }) => {
          const cachedMember = cached?.members.get(identity)
          const resolvedMember =
            cachedMember && cachedMember.signature === signature
              ? cachedMember.member
              : member
          nextMembers.set(identity, { signature, member: resolvedMember })
          return { memberIndex, member: resolvedMember }
        }),
        selected?.name ?? CHAIN_DELAY_GROUP,
        '',
        0,
        latencyTimeout!,
      )

      if (col > 1) {
        const items = groupOccurrences(occurrences, col).map((memberCol) => ({
          type: 4 as const,
          key: `chain-col:${memberKey(group, memberCol[0])}`,
          group,
          headState: DEFAULT_STATE,
          col,
          memberCol,
        }))
        chainCacheRef.current = {
          groupKey,
          contentKey,
          col,
          members: nextMembers,
          itemsByMember: nextItemsByMember,
          items,
        }
        return items
      }

      const items = occurrences.map((occurrence) => {
        const identity = memberIdentity(occurrence.member.ref)
        const cacheKey = `${identity}#${occurrence.memberIndex}`
        const signature = signaturesByKey.get(cacheKey) ?? ''
        const cachedItem = groupContentUnchanged
          ? cached?.itemsByMember.get(cacheKey)
          : undefined
        const item =
          cachedItem && cachedItem.signature === signature
            ? cachedItem.item
            : {
                type: 2 as const,
                key: `chain:${memberKey(group, occurrence)}`,
                group,
                member: occurrence,
                headState: DEFAULT_STATE,
              }
        nextItemsByMember.set(cacheKey, { signature, item })
        return item
      })

      chainCacheRef.current = {
        groupKey,
        contentKey,
        col,
        members: nextMembers,
        itemsByMember: nextItemsByMember,
        items,
      }
      return items
    }

    const cache = groupCacheRef.current

    const getGroupSignatures = (group: ProxyGroupView) => {
      const existing = signatureCache.groups.get(group.name)
      if (existing) return existing

      const memberSignatures = group.members.map(getMemberSignature)
      const computed: GroupSignatures = {
        contentKey: [groupSignature(group), ...memberSignatures].join('\u0000'),
        memberSignatures,
      }
      signatureCache.groups.set(group.name, computed)
      return computed
    }

    const retList = renderGroups.flatMap((group) => {
      const isFlat = group === proxyView.global
      const headState = headStates[group.name] || DEFAULT_STATE
      const cached = cache.get(group.name)
      const groupSignatures = getGroupSignatures(group)
      if (
        cached &&
        cached.contentKey === groupSignatures.contentKey &&
        cached.headState === headState &&
        cached.col === col &&
        cached.latencyTimeout === latencyTimeout &&
        cached.delays === groupDelays.get(group.name)
      ) {
        return cached.items
      }

      const nextMembers = new Map<string, CachedMember>()
      const ret: IRenderItem[] = [
        isFlat
          ? { type: 1, key: `head-${group.name}`, group, headState }
          : {
              type: 0,
              key: group.name,
              group,
              headState,
              icon: group.icon!,
              testUrl: group.testUrl!,
            },
      ]

      if (headState.open || isFlat) {
        const occurrences = filterSort(
          resolveOccurrences(
            proxyView,
            group,
            groupSignatures.memberSignatures,
            cached?.members,
            nextMembers,
          ),
          group.name,
          headState.filterText,
          headState.sortType,
          latencyTimeout!,
          {
            matchCase: headState.filterMatchCase,
            matchWholeWord: headState.filterMatchWholeWord,
            useRegularExpression: headState.filterUseRegularExpression,
          },
        )
        if (occurrences.length === 0) {
          ret.push({ type: 3, key: `empty-${group.name}`, group, headState })
        } else if (col > 1) {
          ret.push(
            ...groupOccurrences(occurrences, col).map((memberCol) => ({
              type: 4 as const,
              key: `col:${memberKey(group, memberCol[0])}`,
              group,
              headState,
              col,
              memberCol,
            })),
          )
        } else {
          ret.push(
            ...occurrences.map((member) => ({
              type: 2 as const,
              key: memberKey(group, member),
              group,
              member,
              headState,
            })),
          )
        }
      }

      cache.set(group.name, {
        contentKey: groupSignatures.contentKey,
        members: nextMembers,
        headState,
        col,
        latencyTimeout: latencyTimeout!,
        delays: groupDelays.get(group.name),
        items: ret,
      })
      return ret
    })

    const filtered =
      mode === 'rule' ? retList.filter((item) => !item.group.hidden) : retList
    if (
      prevListRef.current.length === filtered.length &&
      filtered.every((item, index) => item === prevListRef.current[index])
    ) {
      return prevListRef.current
    }
    prevListRef.current = filtered
    return filtered
  }, [
    chainOccurrences,
    col,
    groupDelays,
    headStates,
    isChainMode,
    latencyTimeout,
    mode,
    proxyView,
    renderGroups,
    selectedGroup,
  ])

  return {
    renderList,
    onProxies: refreshProxy,
    onHeadState: setHeadState,
    currentColumns: col,
  }
}
