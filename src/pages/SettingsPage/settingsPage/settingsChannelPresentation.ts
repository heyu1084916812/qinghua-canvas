import {
  protocolShort,
  type Channel,
} from '../../../domain/project/channel'
import { isBuiltinChannelId } from '../../../domain/project/builtinChannels'
import type {
  ProtocolCatalog,
  ProtocolDefinition,
} from '../../../domain/project/protocol'
import type { ModelCapability } from '../../../domain/shared/capability'
import {
  filterModels,
  groupModelsByCategory,
  type CategoryFilter,
} from '../../../domain/project/modelSelection'
import { channelMenuGeometry } from '../settingsPageRoutingRules'

export function visibleChannelsFor(
  channels: readonly Channel[],
  filter: 'all' | 'enabled' | 'disabled',
  search: string,
  catalog: ProtocolCatalog,
): Channel[] {
  const keyword = search.trim().toLocaleLowerCase()
  return channels.filter((channel) => {
    if (filter === 'enabled' && !channel.enabled) return false
    if (filter === 'disabled' && channel.enabled) return false
    if (!keyword) return true
    return (
      channel.name.toLocaleLowerCase().includes(keyword) ||
      protocolShort(channel.protocol, catalog).toLocaleLowerCase().includes(keyword)
    )
  })
}

export function credentialGroupsFor(channel: Channel | null) {
  return [...(channel?.credentialGroups ?? [])].sort(
    (a, b) => b.priority - a.priority || a.createdAt - b.createdAt,
  )
}

export function activeCredentialGroupFor(
  groups: ReturnType<typeof credentialGroupsFor>,
  activeGroupId: string | null,
) {
  return groups.find((group) => group.id === activeGroupId) ?? groups[0] ?? null
}

export function channelMenuPresentationFor(
  channels: readonly Channel[],
  point: { channelId: string; x: number; y: number } | null,
  viewport: { width: number; height: number },
  confirmDelete: boolean,
) {
  const channel = point
    ? channels.find((item) => item.id === point.channelId) ?? null
    : null
  const builtin = channel ? isBuiltinChannelId(channel.id) : false
  return {
    channel,
    builtin,
    ...channelMenuGeometry(point, viewport, confirmDelete, builtin),
  }
}

/**
 * 旧协议只在当前渠道本身使用它时出现，隐藏协议也只保留当前项；否则老渠道
 * 打开下拉会变空。pending 项仍留在渠道下拉，hidden 项已经搬到全局 CLI，
 * 不能再列第二遍。这里只决定可见性，不改协议目录或能力声明。
 */
export function protocolOptionsFor(input: {
  catalog: ProtocolCatalog
  currentProtocol: string
  hiddenBuiltinProtocolIds: ReadonlySet<string>
}): {
  visible: ProtocolDefinition[]
  pending: ProtocolDefinition[]
} {
  const visible = input.catalog.all.filter(
    (protocol) =>
      ((protocol.kind !== 'legacy' && protocol.kind !== 'hidden') ||
        protocol.id === input.currentProtocol) &&
      (!input.hiddenBuiltinProtocolIds.has(protocol.id) ||
        protocol.id === input.currentProtocol),
  )
  const pending = input.catalog.all.filter(
    (protocol) =>
      protocol.status === 'pending' &&
      protocol.kind !== 'hidden' &&
      !input.hiddenBuiltinProtocolIds.has(protocol.id),
  )
  return { visible, pending }
}

export function protocolUsageFor(protocol: string, catalog: ProtocolCatalog) {
  const definition = catalog.all.find((item) => item.id === protocol)
  return {
    note: definition?.note ?? '',
    credentials: definition?.credentials ?? [],
    docUrl: definition?.docUrl ?? '',
  }
}

export function draftModelsFor(
  selected: Channel | null,
  modelCache: readonly ModelCapability[],
  category: CategoryFilter,
  keyword: string,
) {
  return selected ? filterModels(modelCache, category, keyword) : []
}

export function selectedModelGroupsFor(models: readonly ModelCapability[]) {
  return groupModelsByCategory(models).filter((group) => group.models.length > 0)
}
