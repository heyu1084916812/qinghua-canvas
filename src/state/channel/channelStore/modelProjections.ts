import type { Channel, ChannelCredentialGroup } from '../../../domain/project/channel'
import type { ModelCapability } from '../../../domain/shared/capability'
import type { PresetModel } from '../../../domain/project/modelPresets'
import type { RouteStrategy } from '../../../domain/project/modelRouting'
import type { ProtocolCatalog, ProtocolDefinition } from '../../../domain/project/protocol'
import type { RoutePlanResult, RoutePolicy } from '../../../domain/project/routePlan'
import { buildDefaultModelMap } from '../../../domain/project/modelMapping'
import { buildGenerationRoutePlan } from '../../../domain/project/generationRouting'
import { normalizeRoutePolicy } from '../../../domain/project/routePlan'

type CustomProtocolRow = Record<string, unknown> | null | undefined

export function toCustomProtocolDefinition(
  row: CustomProtocolRow,
): ProtocolDefinition | null {
  if (!row || typeof row !== 'object' || typeof row.id !== 'string') return null
  const capabilities = Array.isArray(row.capabilities)
    ? (row.capabilities.filter((c) => c === 'chat' || c === 'image' || c === 'video') as ProtocolDefinition['capabilities'])
    : []
  const recipe =
    row.recipe && typeof row.recipe === 'object'
      ? (row.recipe as ProtocolDefinition['recipe'])
      : undefined
  return {
    id: row.id,
    name: typeof row.name === 'string' ? row.name : row.id,
    short: typeof row.short === 'string' ? row.short : row.id,
    family: recipe ? 'declarative-http' : 'openai-compatible',
    kind: 'custom',
    status: 'ready',
    capabilities,
    ...(typeof row.defaultBaseUrl === 'string' ? { defaultBaseUrl: row.defaultBaseUrl } : {}),
    ...(typeof row.versionPath === 'string' ? { versionPath: row.versionPath } : {}),
    ...(typeof row.docUrl === 'string' ? { docUrl: row.docUrl } : {}),
    ...(recipe ? { recipe } : {}),
  }
}

export function filteredGlobalModels(
  builtins: readonly PresetModel[],
  customModels: readonly PresetModel[],
  uncommonModelIds: readonly string[],
  category: PresetModel['category'],
  includeUncommon = false,
): PresetModel[] {
  const uncommon = new Set(uncommonModelIds)
  return [...builtins, ...customModels].filter(
    (model) => model.category === category && (includeUncommon || !uncommon.has(model.id)),
  )
}

export function findGlobalModel(
  builtins: readonly PresetModel[],
  customModels: readonly PresetModel[],
  name: string,
): PresetModel | undefined {
  const key = name.trim()
  return [...builtins, ...customModels].find((model) => model.id === key)
}

export function withManualCategory(
  model: ModelCapability,
  modelId: string,
  category: ModelCapability['category'],
): ModelCapability {
  return model.id === modelId
    ? {
        ...model,
        category,
        upstreamCategory:
          model.upstreamCategory ??
          (model.category === 'unknown' ? undefined : model.category),
        categoryManual: true,
      }
    : model
}

export function routeTuningPatch(
  patch: { priority?: number; weight?: number },
): { priority?: number; weight?: number } {
  const next: { priority?: number; weight?: number } = {}
  if (typeof patch.priority === 'number') {
    next.priority = Number.isFinite(patch.priority) ? Math.trunc(patch.priority) : 0
  }
  if (typeof patch.weight === 'number') {
    const w = Number.isFinite(patch.weight) ? Math.trunc(patch.weight) : 0
    next.weight = Math.max(0, w)
  }
  return next
}

export function loadedRoutingPolicy(
  storedRoutingPolicy: RoutePolicy,
  routeStrategy: RouteStrategy,
): RoutePolicy {
  return storedRoutingPolicy.strategy === 'priority' && routeStrategy !== 'priority'
    ? { ...storedRoutingPolicy, strategy: routeStrategy }
    : storedRoutingPolicy
}

export function legacyRouteStrategyFor(
  routingPolicy: RoutePolicy,
  currentStrategy: RouteStrategy,
): RouteStrategy {
  return routingPolicy.strategy === 'round_robin'
    ? currentStrategy
    : (routingPolicy.strategy as RouteStrategy)
}

export function normalizedRoutingPolicy(
  current: RoutePolicy,
  patch: Partial<RoutePolicy>,
): RoutePolicy {
  return normalizeRoutePolicy({ ...current, ...patch })
}

export interface RefreshModelsProjection {
  models: ModelCapability[]
  logicalNames: string[]
  refreshedSelection: ModelCapability[]
  nextGroups: ChannelCredentialGroup[]
  modelMap: Channel['modelMap']
  update: Partial<Channel>
  statusModelCount: number
}

export function projectRefreshModels(args: {
  channel: Channel
  group: ChannelCredentialGroup | undefined
  pulled: readonly ModelCapability[]
}): RefreshModelsProjection {
  const { channel, group, pulled } = args
  const manualById = new Map(
    [...(group?.modelCache ?? channel.modelCache), ...(group?.models ?? channel.models)]
      .filter((model) => model.categoryManual)
      .map((model) => [model.id, model]),
  )
  const models = pulled.map((model) => {
    const manual = manualById.get(model.id)
    return manual
      ? {
          ...model,
          category: manual.category,
          upstreamCategory: model.category === 'unknown' ? undefined : model.category,
          categoryManual: true,
        }
      : model
  })
  const logicalNames = [
    ...new Set([
      ...models.map((model) => model.id),
      ...(group?.models ?? channel.models).map((model) => model.id),
    ]),
  ]
  const refreshedSelection = (group?.models ?? channel.models).map(
    (selected) => models.find((model) => model.id === selected.id) ?? selected,
  )
  const nextGroups = group
    ? channel.credentialGroups.map((item) =>
        item.id === group.id
          ? { ...item, modelCache: models, models: refreshedSelection }
          : item,
      )
    : channel.credentialGroups
  const modelMap = buildDefaultModelMap(
    channel.modelMap,
    logicalNames,
    models.map((model) => model.id),
  )
  return {
    models,
    logicalNames,
    refreshedSelection,
    nextGroups,
    modelMap,
    update: {
      ...(group
        ? { credentialGroups: nextGroups }
        : { modelCache: models, models: refreshedSelection }),
      modelMap,
    },
    statusModelCount: models.length,
  }
}

export function clearStaleModelCaches(channels: readonly Channel[]): Channel[] {
  const stale = channels.filter(
    (channel) =>
      channel.protocol === 'runninghub-api' &&
      !channel.hasToken &&
      (channel.modelCache.length > 0 || channel.models.length > 0),
  )
  if (stale.length === 0) return [...channels]
  const clearedById = new Map(
    stale.map((channel) => [
      channel.id,
      {
        ...channel,
        modelCache: [],
        models: [],
        credentialGroups: channel.credentialGroups.map((group) => ({
          ...group,
          modelCache: [],
          models: [],
        })),
      },
    ]),
  )
  return channels.map((channel) => clearedById.get(channel.id) ?? channel)
}

export function staleModelCachePatches(
  channels: readonly Channel[],
): { id: string; patch: Partial<Channel> }[] {
  return channels
    .filter(
      (channel) =>
        channel.protocol === 'runninghub-api' &&
        !channel.hasToken &&
        (channel.modelCache.length > 0 || channel.models.length > 0),
    )
    .map((channel) => ({
      id: channel.id,
      patch: {
        modelCache: [],
        models: [],
        credentialGroups: channel.credentialGroups.map((group) => ({
          ...group,
          modelCache: [],
          models: [],
        })),
      },
    }))
}

export function tokenlessRoutableChannels(
  channels: readonly Channel[],
  hasLocalCli: boolean,
  tokenless: (protocol: string, hasLocalCli: boolean) => boolean,
): Channel[] {
  return channels.map((channel) => {
    const allowed = tokenless(channel.protocol, hasLocalCli)
    return {
      ...channel,
      hasToken: allowed || channel.hasToken,
      credentialGroups: channel.credentialGroups.map((group) => ({
        ...group,
        hasToken: allowed || group.hasToken,
      })),
    }
  })
}

export function buildRoutePlan(
  channels: readonly Channel[],
  opts: {
    category: 'image' | 'video' | 'chat'
    logicalModel: string
    explicitChannelId?: string
  },
  policy: RoutePolicy,
  cursor?: number,
): RoutePlanResult {
  return buildGenerationRoutePlan({
    channels,
    category: opts.category,
    logicalModel: opts.logicalModel,
    policy,
    ...(cursor !== undefined ? { cursor } : {}),
  })
}

export function protocolDefinitionRows(
  rows: readonly CustomProtocolRow[],
): ProtocolDefinition[] {
  return rows
    .map((row) => toCustomProtocolDefinition(row))
    .filter((definition): definition is ProtocolDefinition => definition !== null)
}

export function catalogOf(
  customProtocols: readonly ProtocolDefinition[],
  build: (custom: readonly ProtocolDefinition[]) => ProtocolCatalog,
): ProtocolCatalog {
  return build(customProtocols)
}
