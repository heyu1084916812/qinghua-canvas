import { protocolNeedsNoToken } from '../../domain/project/channel'
import { routeCandidateKey, type RouteCandidateRef } from '../../domain/project/routePlan'
import type { Channel } from '../../domain/project/channel'

export interface RouteCandidateRow {
  ref: RouteCandidateRef
  key: string
  channelName: string
  groupName: string
  hasToken: boolean
  enabled: boolean
}

export interface RoutingChannelGroup {
  channelId: string
  channelName: string
  candidates: RouteCandidateRow[]
}

export function routingCandidatesFor(
  channels: readonly Channel[],
  hasLocalCli: boolean,
): RouteCandidateRow[] {
  return channels.filter((channel) => channel.enabled).flatMap((channel) => {
    const tokenless = protocolNeedsNoToken(channel.protocol, hasLocalCli)
    const groups = channel.credentialGroups.length > 0
      ? channel.credentialGroups.map((group) => ({
          id: group.id,
          name: group.name,
          hasToken: tokenless || group.hasToken,
        }))
      : [{ id: undefined, name: '渠道级 Key', hasToken: tokenless || channel.hasToken }]
    return groups.map((group) => {
      const ref: RouteCandidateRef = {
        channelId: channel.id,
        ...(group.id ? { credentialGroupId: group.id } : {}),
      }
      return {
        ref,
        key: routeCandidateKey(ref),
        channelName: channel.name,
        groupName: group.name,
        hasToken: group.hasToken,
        enabled: channel.enabled,
      }
    })
  })
}

export function routingChannelGroupsFor(
  candidates: readonly RouteCandidateRow[],
): RoutingChannelGroup[] {
  const groups = new Map<string, RoutingChannelGroup>()
  for (const candidate of candidates) {
    const current = groups.get(candidate.ref.channelId)
    if (current) current.candidates.push(candidate)
    else {
      groups.set(candidate.ref.channelId, {
        channelId: candidate.ref.channelId,
        channelName: candidate.channelName,
        candidates: [candidate],
      })
    }
  }
  return [...groups.values()]
}

export function selectedRoutingKeysFor(
  candidates: readonly RouteCandidateRow[],
  allowed: readonly RouteCandidateRef[],
): Set<string> {
  const all = new Set(candidates.map((candidate) => candidate.key))
  if (allowed.length === 0) return all
  return new Set(allowed.map(routeCandidateKey).filter((key) => all.has(key)))
}

export function nextAllowedCandidatesFor(
  candidates: readonly RouteCandidateRow[],
  keys: ReadonlySet<string>,
): RouteCandidateRef[] | null {
  if (keys.size === 0) return null
  if (keys.size === candidates.length) return []
  return candidates
    .filter((candidate) => keys.has(candidate.key))
    .map((candidate) => candidate.ref)
}

export function channelMenuGeometry(
  point: { x: number; y: number } | null,
  viewport: { width: number; height: number },
  confirmDelete: boolean,
  builtin: boolean,
) {
  const width = 184
  const height = confirmDelete ? 164 : builtin ? 52 : 104
  return {
    width,
    left: point ? Math.max(8, Math.min(point.x, viewport.width - width - 8)) : 0,
    top: point ? Math.max(8, Math.min(point.y, viewport.height - height - 8)) : 0,
  }
}
