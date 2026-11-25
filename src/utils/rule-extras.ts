import type { RuleExtraInfo } from '@/services/cmds'

const isSameExtra = (left: RuleExtraInfo, right: RuleExtraInfo) =>
  left.index === right.index &&
  left.disabled === right.disabled &&
  left.hitCount === right.hitCount &&
  left.hitAt === right.hitAt &&
  left.missCount === right.missCount &&
  left.missAt === right.missAt

/**
 * Merges a fresh hit-counter snapshot into the page's map while keeping every
 * unchanged entry's identity. The counters refresh every 15 s; rebuilding the
 * whole map (12k entries on a big rule set) made every visible row re-render
 * even when nothing had changed.
 */
export const mergeRuleExtras = (
  previous: ReadonlyMap<number, RuleExtraInfo>,
  extras: readonly RuleExtraInfo[],
): ReadonlyMap<number, RuleExtraInfo> => {
  let changed = previous.size !== extras.length
  const next = new Map<number, RuleExtraInfo>()

  for (const extra of extras) {
    const previousExtra = previous.get(extra.index)
    if (previousExtra && isSameExtra(previousExtra, extra)) {
      next.set(extra.index, previousExtra)
      continue
    }
    changed = true
    next.set(extra.index, extra)
  }

  return changed ? next : previous
}
