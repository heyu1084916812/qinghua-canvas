import type { Channel } from '../../../domain/project/channel'
import type { RouteCandidateRef } from '../../../domain/project/routePlan'
import {
  nextAllowedCandidatesFor,
  routingCandidatesFor,
  routingChannelGroupsFor,
  selectedRoutingKeysFor,
  type RouteCandidateRow,
} from '../settingsPageRoutingRules'

export interface RoutingActions {
  set(next: ReadonlySet<string>): boolean
  toggleCandidate(candidateKey: string, checked: boolean): boolean
  toggleChannel(candidates: readonly RouteCandidateRow[], checked: boolean): boolean
}

export function routingPresentationFor(
  channels: readonly Channel[],
  hasLocalCli: boolean,
  allowedCandidates: readonly RouteCandidateRef[],
) {
  const candidates = routingCandidatesFor(channels, hasLocalCli)
  return {
    candidates,
    groups: routingChannelGroupsFor(candidates),
    selectedKeys: selectedRoutingKeysFor(candidates, allowedCandidates),
  }
}

/** 选路只改策略端口；空集合和含失效 key 的集合都不得落库。 */
export function createRoutingActions(
  candidates: readonly RouteCandidateRow[],
  selectedKeys: ReadonlySet<string>,
  setPolicy: (next: { allowedCandidates: RouteCandidateRef[] }) => void,
): RoutingActions {
  const validKeys = new Set(candidates.map((candidate) => candidate.key))
  const set = (next: ReadonlySet<string>): boolean => {
    if (next.size === 0) return false
    if ([...next].some((key) => !validKeys.has(key))) return false
    const allowedCandidates = nextAllowedCandidatesFor(candidates, next)
    if (!allowedCandidates) return false
    setPolicy({ allowedCandidates })
    return true
  }

  return {
    set,
    toggleCandidate(candidateKey, checked) {
      const next = new Set(selectedKeys)
      if (checked) next.add(candidateKey)
      else next.delete(candidateKey)
      return set(next)
    },
    toggleChannel(channelCandidates, checked) {
      const next = new Set(selectedKeys)
      for (const candidate of channelCandidates) {
        if (checked) next.add(candidate.key)
        else next.delete(candidate.key)
      }
      return set(next)
    },
  }
}

export function toggleRoutingChannelExpanded(
  current: ReadonlySet<string>,
  channelId: string,
): Set<string> {
  const next = new Set(current)
  if (next.has(channelId)) next.delete(channelId)
  else next.add(channelId)
  return next
}
