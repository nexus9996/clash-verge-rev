import type { PopperProps } from '@mui/material'

import type { ProxySortType } from '@/components/proxy/use-filter-sort'
import {
  findCurrentGroupMember,
  isInteractableMember,
  resolveMember,
  type InteractableProxyMemberOccurrence,
  type ProxyGroupView,
  type ProxyViewV1,
  type ResolvedProxyMember,
} from '@/types/proxy-view'
import { compareByDelay, DEFAULT_DELAY_TIMEOUT } from '@/utils/delay'

export const STORAGE_KEY_GROUP = 'clash-verge-selected-proxy-group'
export const STORAGE_KEY_SORT_TYPE = 'clash-verge-proxy-sort-type'

export const AUTO_CHECK_DEFAULT_INTERVAL_MINUTES = 5
export const AUTO_CHECK_INITIAL_DELAY_MS = 100

const PROXY_MENU_MAX_HEIGHT = 500
const PROXY_MENU_VIEWPORT_MARGIN = 8

export const proxyMenuModifiers: PopperProps['modifiers'] = [
  {
    name: 'menuSize',
    enabled: true,
    phase: 'beforeRead',
    fn: ({ state }) => {
      const popper = state.elements.popper
      const anchor = state.elements.reference.getBoundingClientRect()
      const viewportHeight = popper.ownerDocument.documentElement.clientHeight
      // Use the larger side before flip runs so sizing cannot alternate with placement.
      const availableHeight =
        Math.max(anchor.top, viewportHeight - anchor.bottom) -
        PROXY_MENU_VIEWPORT_MARGIN
      popper.style.width = `${anchor.width}px`
      popper.style.setProperty(
        '--proxy-menu-max-height',
        `${Math.max(0, Math.min(PROXY_MENU_MAX_HEIGHT, availableHeight))}px`,
      )
      state.rects.popper.width = popper.offsetWidth
      state.rects.popper.height = popper.offsetHeight
    },
  },
  {
    name: 'showMenu',
    enabled: true,
    phase: 'beforeWrite',
    requires: ['computeStyles'],
    fn: ({ state }) => {
      state.styles.popper.visibility = 'visible'
    },
  },
]

export interface ProxyOption {
  memberIndex: number
  member: ResolvedProxyMember
  value: string
  name: string
  disabled: boolean
}

export interface RuleEntry {
  group: ProxyGroupView
  ruleCount: number
  isDefault: boolean
}

export interface ChainLevel {
  group: Pick<ProxyGroupView, 'name' | 'members' | 'fixed'>
  current?: InteractableProxyMemberOccurrence
}

export const SELECTABLE_GROUP_TYPES = ['Selector', 'URLTest', 'Fallback']

export const ENTRY_SELECT = 'entry'
export const levelSelect = (groupName: string) => `level:${groupName}`

export const resolveChain = (view: ProxyViewV1, entry: ProxyGroupView) => {
  const levels: ChainLevel[] = []
  let group: ProxyGroupView | undefined = entry
  while (group) {
    const current = findCurrentGroupMember(view, group)
    levels.push({ group, current })
    // A load-balance member has no single active node, so the chain ends on it.
    group =
      current?.member.kind === 'group' &&
      SELECTABLE_GROUP_TYPES.includes(current.member.group.type)
        ? current.member.group
        : undefined
  }
  return levels
}

export const optionValue = (memberIndex: number, member: ResolvedProxyMember) =>
  `${memberIndex}:${
    member.kind === 'node' ? member.node.recordId : member.ref.name
  }`

const sortProxyOptions = (
  options: ProxyOption[],
  sortType: 0 | 1,
  delayOf: (member: ResolvedProxyMember) => number,
  latencyTimeout?: number,
) => {
  if (sortType === 0) return options

  const effectiveTimeout =
    typeof latencyTimeout === 'number' && latencyTimeout > 0
      ? latencyTimeout
      : DEFAULT_DELAY_TIMEOUT

  return options
    .map((option) => ({ option, delay: delayOf(option.member) }))
    .sort((a, b) => {
      const byDelay = compareByDelay(a.delay, b.delay, effectiveTimeout)
      return byDelay || a.option.name.localeCompare(b.option.name)
    })
    .map(({ option }) => option)
}

/** Builds the option list for one chain level, preserving member order for unsorted views. */
export const buildProxyOptions = (
  view: ProxyViewV1,
  group: ChainLevel['group'],
  sortType: ProxySortType | undefined,
  delayOf: (member: ResolvedProxyMember) => number,
  latencyTimeout?: number,
): ProxyOption[] => {
  const unsorted = group.members.map((memberRef, memberIndex) => {
    const member = resolveMember(view, memberRef)
    return {
      memberIndex,
      member,
      value: optionValue(memberIndex, member),
      name: member.ref.name,
      disabled: !isInteractableMember(member),
    }
  })
  return sortType === 2
    ? unsorted.sort((a, b) => a.name.localeCompare(b.name))
    : sortProxyOptions(unsorted, sortType as 0 | 1, delayOf, latencyTimeout)
}
