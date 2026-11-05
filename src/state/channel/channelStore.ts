import { createStore as createVanilla } from 'zustand/vanilla'
import type { Channel } from '../../domain/project/channel'
import {
  channelIsRoutable,
  protocolNeedsNoToken,
  requiresBaseUrl,
} from '../../domain/project/channel'
import {
  BUILTIN_PROTOCOLS,
  buildProtocolCatalog,
  protocolById,
  stationProtocolForUrl,
  validateCustomProtocol,
  PROBE_VERSION_PATHS,
  type CustomProtocolInput,
  type ProtocolDefinition,
} from '../../domain/project/protocol'
import { setModelMapping } from '../../domain/project/modelMapping'
import type { ModelCapability } from '../../domain/shared/capability'
import {
  PRESET_MODELS,
  type PresetModel,
} from '../../domain/project/modelPresets'
import { createChannelRepository, type ChannelRepository } from '../project/channelRepository'
import { createChannelCredentials } from './channelCredentials'
import { createChannelRequestOrchestration } from './channelRequestOrchestration'
import { BUILTIN_CHANNEL_IDS, isBuiltinChannelId } from '../../domain/project/builtinChannels'
import { createPresetStore, type PresetStore } from '../project/presetStore'
import { createRoutingPolicyStore } from '../project/routingPolicyStore'
import {
  createChannelAdapter,
  type ResolvedChannelConfig,
} from '../../platform/channels/registry'
import type { VerifyResult } from '../../platform/channels/types'
import { describeError, asAppError } from '../../shared/result'
import {
  createGenerationClient,
  resolvedChannelConfig,
} from '../../platform/generation'
import { createContextRepository } from '../shared/contextRepository'
import {
  initialChannelStoreState,
  timeoutSignal,
  type MiniStore,
  type StoreFactory,
  type PlatformKit,
  type ProtocolCatalog,
  type RouteStrategy,
  type RoutePlanResult,
  type RoutePolicy,
  type PresetVendor,
  type CreateChannelInput,
  type CustomProtocolValidation,
  type ChannelCredentialGroup,
  type CredentialSlot,
  type ChatMessage,
  type NodeInput,
  type ToolDeclaration,
  type StreamChunk,
  type DirectRunRouteCandidate,
  type DirectRunTraceInput,
  type GeneratedAsset,
  type SpeechRunRequest,
  type TextResult,
  type VideoRunRequest,
} from './channelStore/contracts'

/** 「验证地址」的结果：只回答地址通不通与往返延迟。 */
export interface ChannelVerify {
  status: 'idle' | 'checking' | 'ok' | 'error'
  message?: string
  latency?: number
}

/** 「拉取模型」的结果：与验证分开，关心的是拿到了几个模型。 */
export interface ChannelModelsResult {
  status: 'idle' | 'checking' | 'ok' | 'error'
  message?: string
  modelCount?: number
}

/** 「验证协议」的结果：命中的协议与全失败原因。 */
export interface ChannelDetect {
  status: 'idle' | 'checking' | 'ok' | 'error'
  protocol: string | null
  message?: string
}

export interface ModelMappingTestResult {
  status: 'ok' | 'missing' | 'error'
  message: string
  latencyMs?: number
  modelCount?: number
}

export interface ChannelStoreState {
  channels: Channel[]
  routeStrategy: RouteStrategy
  routingPolicy: RoutePolicy
  recipeMemory: boolean
  customProtocols: ProtocolDefinition[]
  hiddenBuiltinProtocolIds: string[]
  customModels: PresetModel[]
  uncommonModelIds: string[]
  loaded: boolean
  verify: ChannelVerify
  models: ChannelModelsResult
  detect: ChannelDetect
}

export interface ChannelStoreActions {
  load(): Promise<void>
  protocolCatalog(): ProtocolCatalog
  createCustomProtocol(input: CustomProtocolInput): Promise<CustomProtocolValidation>
  removeCustomProtocol(id: string): Promise<void>
  removeBuiltinProtocol(id: string): Promise<void>
  restoreBuiltinProtocols(): Promise<void>
  create(input: CreateChannelInput): Promise<Channel>
  update(id: string, patch: Partial<Channel>): Promise<Channel>
  remove(id: string): Promise<void>
  globalModelsOf(category: PresetModel['category'], includeUncommon?: boolean): PresetModel[]
  globalModelOf(name: string): PresetModel | undefined
  addGlobalModel(input: {
    name: string
    category: PresetModel['category']
    vendor: PresetVendor
  }): Promise<PresetModel>
  removeGlobalModel(name: string): Promise<void>
  setModelUncommon(name: string, uncommon: boolean): Promise<void>
  testModelMapping(
    id: string,
    logicalName: string,
    upstreamId: string,
    groupId?: string,
  ): Promise<ModelMappingTestResult>
  reorder(orderedIds: string[]): Promise<void>
  saveToken(id: string, token: string, slot?: CredentialSlot): Promise<void>
  loadToken(id: string, slot?: CredentialSlot): Promise<string | null>
  removeToken(id: string, slot?: CredentialSlot): Promise<void>
  addCredentialGroup(id: string, name?: string): Promise<ChannelCredentialGroup>
  renameCredentialGroup(id: string, groupId: string, name: string): Promise<void>
  setCredentialGroupPriority(id: string, groupId: string, priority: number): Promise<void>
  removeCredentialGroup(id: string, groupId: string): Promise<void>
  saveCredentialGroupToken(id: string, groupId: string, token: string): Promise<void>
  loadCredentialGroupToken(id: string, groupId: string): Promise<string | null>
  removeCredentialGroupToken(id: string, groupId: string): Promise<void>
  setEnabled(id: string, enabled: boolean): Promise<void>
  setModels(id: string, models: ModelCapability[], groupId?: string): Promise<void>
  setModelCategory(
    id: string,
    modelId: string,
    category: ModelCapability['category'],
    groupId?: string,
  ): Promise<void>
  setModelMapping(id: string, logicalName: string, upstreamId: string): Promise<void>
  setRouteTuning(id: string, patch: { priority?: number; weight?: number }): Promise<void>
  setRouteStrategy(strategy: RouteStrategy): Promise<void>
  setRoutingPolicy(patch: Partial<RoutePolicy>): Promise<void>
  planGenerationRoute(opts: {
    category: 'image' | 'video' | 'chat'
    logicalModel: string
    explicitChannelId?: string
  }): Promise<RoutePlanResult>
  hasToken(id: string, slot?: CredentialSlot): Promise<boolean>
  verify(id: string, groupId?: string): Promise<void>
  detectProtocol(id: string, groupId?: string): Promise<string | null>
  refreshModels(id: string, groupId?: string): Promise<void>
  enabledChannels(): Channel[]
  rememberRecipe(channelId: string, model: string, params: Record<string, unknown>): Promise<void>
  setRecipeMemory(enabled: boolean): Promise<void>
  setDefaultRecipe(channelId: string, model: string, params: Record<string, unknown>): Promise<void>
  defaultForNewNode(
    node: { channelId?: string; model?: string },
    category?: string,
  ): Promise<{ channelId: string; model: string; params: Record<string, unknown>; substituted: boolean } | null>
  completeWithTools(req: {
    channelId: string
    model: string
    modelIsUpstream?: boolean
    tools: readonly ToolDeclaration[]
    messages: readonly ChatMessage[]
    inputs?: readonly NodeInput[]
    signal: AbortSignal
    timeoutMs?: number
    routeCandidates?: readonly DirectRunRouteCandidate[]
    routePlanId?: string
    trace: DirectRunTraceInput
    onRecordWarning?: (warning: string) => void
    onRouteSucceeded?: (route: DirectRunRouteCandidate) => void
    onChunk?: (chunk: StreamChunk) => void
  }): Promise<TextResult>
  generateSpeech(
    req: SpeechRunRequest & { signal: AbortSignal; trace?: DirectRunTraceInput },
  ): Promise<GeneratedAsset>
  generateVideo(
    req: VideoRunRequest & { signal: AbortSignal; trace?: DirectRunTraceInput },
  ): Promise<GeneratedAsset[]>
}

export type ChannelStore = MiniStore<ChannelStoreState> & ChannelStoreActions
import {
  buildRoutePlan,
  filteredGlobalModels,
  findGlobalModel,
  loadedRoutingPolicy,
  normalizedRoutingPolicy,
  projectRefreshModels,
  protocolDefinitionRows,
  routeTuningPatch,
  staleModelCachePatches,
  tokenlessRoutableChannels,
  withManualCategory,
  legacyRouteStrategyFor,
} from './channelStore/modelProjections'
import { createRecipeCache } from './channelStore/recipeCache'

const createVanillaStore = createVanilla as unknown as StoreFactory

function toSafeConfig(ch: Channel, catalog: ProtocolCatalog): ResolvedChannelConfig {
  return resolvedChannelConfig(ch, catalog, null, null)
}
/**
 * @param opts.seedBuiltins 读表时是否补齐常驻内置渠道（默认 true）。
 *   测试里空态用例传 false，真实运行时内置渠道必须常驻。
 */
export function createChannelStore(
  platform: PlatformKit,
  opts: { seedBuiltins?: boolean } = {},
): ChannelStore {
  const contextRepo = createContextRepository(platform.storage)
  const seedBuiltins = opts.seedBuiltins !== false
  const repo: ChannelRepository = createChannelRepository(platform.storage, platform.credentials)
  const presets: PresetStore = createPresetStore(platform.storage)
  const routingPolicies = createRoutingPolicyStore(platform.storage)
  const removingChannelIds = new Set<string>()
  const visibleChannels = (channels: Channel[]): Channel[] =>
    channels.filter((channel) => !removingChannelIds.has(channel.id))
  const generation = createGenerationClient({
    platform,
    catalog: () => catalog(),
    loadToken: (credentialRef) => credentials.loadByRef(credentialRef),
  })
  const store = createVanillaStore<ChannelStoreState>(initialChannelStoreState)
  const credentials = createChannelCredentials(repo, platform.credentials, (id, patch) =>
    update(id, patch),
  )
  const loadKeys = credentials.loadKeys
  const credentialGroupOf = credentials.credentialGroupOf
  const patchCredentialGroup = credentials.patchCredentialGroup

  /** 当前目录：内置 + 已加载的自建。每次读取都现算，避免忘了在增删后同步 */
  const catalog = (): ProtocolCatalog =>
    buildProtocolCatalog(store.getState().customProtocols)

  const load: ChannelStoreActions['load'] = async () => {
    /**
     * 配方**不在这里预读**：它是按项目的，而 store 这一层不知道当前是哪个项目。
     * 改成 `defaultForNewNode(projectId)` 时按需读一次（结果进 recipeCache）。
     */
    const [
      loadedChannels,
      customRows,
      storedHiddenBuiltinProtocolIds,
      customModels,
      uncommonModelIds,
      routeStrategy,
      storedRoutingPolicy,
      recipeMemory,
    ] =
      await Promise.all([
      /**
       * ★ 读表时**补齐常驻内置渠道**（用户第 20 批起）：它们常驻、置顶、不可删。
       * 补齐放在仓储里（写行的唯一入口），这里只负责取"补完之后的整表"。
       */
      seedBuiltins ? repo.seedBuiltins() : repo.list(),
      platform.storage.query('customProtocols', {}),
      presets.loadHiddenBuiltinProtocols(),
      presets.loadCustomModels(),
      presets.loadUncommonModels(),
      presets.loadRoutingStrategy(),
      routingPolicies.load(),
      presets.loadRecipeMemory(),
      ])
    const routingPolicy = loadedRoutingPolicy(storedRoutingPolicy, routeStrategy)
    let channels = visibleChannels(loadedChannels)
    const stalePatches = staleModelCachePatches(channels)
    if (stalePatches.length > 0) {
      const cleared = await Promise.all(
        stalePatches.map(({ id, patch }) => repo.update(id, patch)),
      )
      const clearedById = new Map(cleared.map((c) => [c.id, c]))
      channels = channels.map((c) => clearedById.get(c.id) ?? c)
    }
    const customProtocols = protocolDefinitionRows(customRows)
    const hiddenBuiltinProtocolIds = storedHiddenBuiltinProtocolIds.filter((id) =>
      BUILTIN_PROTOCOLS.some((protocol) => protocol.id === id && protocol.kind === 'station'),
    )
    store.setState({
      channels,
      customProtocols,
      hiddenBuiltinProtocolIds,
      customModels,
      uncommonModelIds,
      routeStrategy,
      routingPolicy,
      recipeMemory,
      loaded: true,
    })
  }

  const createCustomProtocol: ChannelStoreActions['createCustomProtocol'] = async (input) => {
    const result = validateCustomProtocol(input, catalog().all)
    if (!result.ok) return result
    await platform.storage.put('customProtocols', { ...result.value })
    store.setState((s) => ({ customProtocols: [...s.customProtocols, result.value] }))
    return result
  }

  const removeCustomProtocol: ChannelStoreActions['removeCustomProtocol'] = async (id) => {
    const usedBy = store.getState().channels.filter((c) => c.protocol === id)
    if (usedBy.length > 0) {
      throw new Error(`仍有 ${usedBy.length} 条渠道在使用该协议，请先改协议或删除渠道`)
    }
    await platform.storage.delete('customProtocols', id)
    store.setState((s) => ({ customProtocols: s.customProtocols.filter((p) => p.id !== id) }))
  }

  const removeBuiltinProtocol: ChannelStoreActions['removeBuiltinProtocol'] = async (id) => {
    const definition = BUILTIN_PROTOCOLS.find((protocol) => protocol.id === id)
    if (!definition) throw new Error('这条协议不是内置协议，不能按内置协议移除')
    if (definition.kind !== 'station') {
      throw new Error('这里只能移除站点协议，基础协议和公开模板不在管理范围')
    }
    const usedBy = store.getState().channels.filter((channel) => channel.protocol === id)
    if (usedBy.length > 0) {
      throw new Error(`仍有 ${usedBy.length} 条渠道在使用该协议，请先改协议或删除渠道`)
    }
    const next = [...new Set([...store.getState().hiddenBuiltinProtocolIds, id])]
    await presets.saveHiddenBuiltinProtocols(next)
    store.setState({ hiddenBuiltinProtocolIds: next })
  }

  const restoreBuiltinProtocols: ChannelStoreActions['restoreBuiltinProtocols'] = async () => {
    await presets.saveHiddenBuiltinProtocols([])
    store.setState({ hiddenBuiltinProtocolIds: [] })
  }

  const create: ChannelStoreActions['create'] = async (input) => {
    const ch = await repo.create(input)
    // 落库后**重读整表**，而不是把新渠道 unshift 到内存表头。
    // 列表顺序自 §7.2 起由 `order` 决定（可由用户拖动），新渠道按约定排在末尾；
    // 内存里再自作主张插到最前，就会出现「刷新一下顺序变了」——两套顺序认知。
    store.setState({ channels: await repo.list() })
    return ch
  }

  const update: ChannelStoreActions['update'] = async (id, patch) => {
    const ch = await repo.update(id, patch)
    store.setState((s) => ({ channels: s.channels.map((c) => (c.id === id ? ch : c)) }))
    return ch
  }

  const remove: ChannelStoreActions['remove'] = async (id) => {
    if (isBuiltinChannelId(id)) {
      throw new Error('这是内置渠道，不能删除')
    }
    const target = store.getState().channels.find((channel) => channel.id === id)
    if (!target) return

    /**
     * The in-memory table is the routing authority. Mark the channel
     * unroutable before the first await so no new task can enter the provider
     * while credentials are being removed.
     */
    removingChannelIds.add(id)
    store.setState((s) => ({
      channels: s.channels.filter((channel) => channel.id !== id),
    }))

    try {
      await repo.remove(id)
    } catch (error) {
      removingChannelIds.delete(id)
      // 删除可能已经把渠道写成停用态后才因凭据清理失败；重新读表，
      // 让界面立即反映真实状态，不能继续显示一条实际已不可用的旧行。
      store.setState({ channels: await repo.list() })
      throw error
    }
  }

  const globalModelsOf: ChannelStoreActions['globalModelsOf'] = (
    category,
    includeUncommon = false,
  ) => {
    return filteredGlobalModels(
      PRESET_MODELS,
      store.getState().customModels,
      store.getState().uncommonModelIds,
      category,
      includeUncommon,
    )
  }

  const globalModelOf: ChannelStoreActions['globalModelOf'] = (name) => {
    return findGlobalModel(PRESET_MODELS, store.getState().customModels, name)
  }

  const addGlobalModel: ChannelStoreActions['addGlobalModel'] = async (input) => {
    const name = input.name.trim()
    if (!name) throw new Error('模型名称不能为空')
    if (globalModelOf(name)) throw new Error(`前端模型「${name}」已经存在`)
    const model: PresetModel = {
      id: name,
      category: input.category,
      vendor: input.vendor,
    }
    const next = [...store.getState().customModels, model]
    await presets.saveCustomModels(next)
    store.setState({ customModels: next })
    return model
  }

  const removeGlobalModel: ChannelStoreActions['removeGlobalModel'] = async (name) => {
    const key = name.trim()
    if (!store.getState().customModels.some((model) => model.id === key)) {
      throw new Error('内置前端模型不能删除')
    }
    const next = store.getState().customModels.filter((model) => model.id !== key)
    await presets.saveCustomModels(next)
    const uncommonModelIds = store.getState().uncommonModelIds.filter((id) => id !== key)
    await presets.saveUncommonModels(uncommonModelIds)
    store.setState({ customModels: next, uncommonModelIds })
  }

  const setModelUncommon: ChannelStoreActions['setModelUncommon'] = async (name, uncommon) => {
    const key = name.trim()
    if (!globalModelOf(key)) throw new Error(`前端模型「${key}」不存在`)
    const ids = new Set(store.getState().uncommonModelIds)
    if (uncommon) ids.add(key)
    else ids.delete(key)
    const uncommonModelIds = [...ids]
    await presets.saveUncommonModels(uncommonModelIds)
    store.setState({ uncommonModelIds })
  }

  const testModelMapping: ChannelStoreActions['testModelMapping'] = async (
    id,
    logicalName,
    upstreamId,
    groupId,
  ) => {
    const ch = await repo.get(id)
    if (!ch) return { status: 'error', message: '模型服务不存在' }
    const group =
      ch.credentialGroups.length > 0 ? credentialGroupOf(ch, groupId) : undefined
    const groupKey = group ? await credentials.loadByRef(group.credentialRef) : null
    const { apiKey: legacyApiKey, altApiKey } = await loadKeys(ch)
    const config: ResolvedChannelConfig = {
      ...toSafeConfig(ch, catalog()),
      ...(group
        ? { credentialRef: group.credentialRef, modelCache: group.modelCache }
        : {}),
      apiKey: groupKey ?? legacyApiKey,
      altApiKey,
    }
    const target = upstreamId.trim() || logicalName.trim()
    if (!target) return { status: 'error', message: '映射后的模型 ID 为空' }
    const startedAt = Date.now()
    try {
      const models = await createChannelAdapter(config, platform).listModels(
        config,
        timeoutSignal(10_000),
      )
      const latencyMs = Date.now() - startedAt
      if (models.some((model) => model.id === target)) {
        return {
          status: 'ok',
          message: `目录中已找到「${target}」`,
          latencyMs,
          modelCount: models.length,
        }
      }
      return {
        status: 'missing',
        message: `目录返回 ${models.length} 个模型，但没有「${target}」。目录不完整时不能据此判定映射失效。`,
        latencyMs,
        modelCount: models.length,
      }
    } catch (error) {
      const app = asAppError(error)
      return {
        status: 'error',
        message: app ? describeError(app) : error instanceof Error ? error.message : String(error),
        latencyMs: Date.now() - startedAt,
      }
    }
  }

  const reorder: ChannelStoreActions['reorder'] = async (orderedIds) => {
    /**
     * **内置渠道永远在最前**（用户第 20 批：「那三个渠道是一直在最上面」）：
     * 把传入的顺序按"内置在前、其余照用户拖的次序"重排一遍 ——
     * 用户拖不动它们，别人也挤不到它们上面。
     */
    const front = [...BUILTIN_CHANNEL_IDS]
    const rest = orderedIds.filter((id) => !isBuiltinChannelId(id))
    const channels = await repo.reorder([...front, ...rest])
    store.setState({ channels })
  }

  /**
   * 启用开关：**先改内存，再落库**（乐观更新，2026-10-08 修）。
   *
   * ## 为什么不能直接 `await update(...)`
   *
   * 开关是**受控**的（`checked={ch.enabled}` 读的是 store）。走 `update` 时
   * 「点击改 DOM → 等 IndexedDB 写完 → 才 setState」这段窗口里，任何一次
   * 无关的重渲染（实测：点开关会顺带冒泡触发列表项的 `setSelectedId`）
   * 都会拿**还没更新的** `ch.enabled` 把 DOM 写回去 —— 表现为开关"弹回去再弹过来"，
   * 用户看到的是闪一下；自动化 `check()/uncheck()` 更直接：它们在点击后**立刻**
   * 读状态，读到回弹那一帧就判定"点了没变"，重试到超时（G69 实测卡死 30s）。
   *
   * 落库失败则**回滚**并把错误抛出去 —— 乐观更新只提前"显示"，不吞掉失败。
   */
  const setEnabled: ChannelStoreActions['setEnabled'] = async (id, enabled) => {
    const flip = (value: boolean) =>
      store.setState((s) => ({
        channels: s.channels.map((c) => (c.id === id ? { ...c, enabled: value } : c)),
      }))
    flip(enabled)
    try {
      await update(id, { enabled })
    } catch (e) {
      flip(!enabled)
      throw e
    }
  }

  const setModels: ChannelStoreActions['setModels'] = async (id, models, groupId) => {
    const ch = await repo.get(id)
    if (!ch) throw new Error(`[channelStore] 渠道不存在：${id}`)
    if (ch.credentialGroups.length === 0) {
      await update(id, { models })
      return
    }
    const group = credentialGroupOf(ch, groupId)
    await patchCredentialGroup(id, group.id, { models })
  }

  const setModelCategory: ChannelStoreActions['setModelCategory'] = async (
    id,
    modelId,
    category,
    groupId,
  ) => {
    const ch = await repo.get(id)
    if (!ch) throw new Error(`[channelStore] 渠道不存在：${id}`)
    const targetGroup = ch.credentialGroups.length
      ? credentialGroupOf(ch, groupId)
      : undefined
    const patchModel = (model: ModelCapability): ModelCapability =>
      withManualCategory(model, modelId, category)
    if (!targetGroup) {
      await update(id, {
        models: ch.models.map(patchModel),
        modelCache: ch.modelCache.map(patchModel),
      })
      return
    }
    await update(id, {
      credentialGroups: ch.credentialGroups.map((group) =>
        group.id === targetGroup.id
          ? {
              ...group,
              models: group.models.map(patchModel),
              modelCache: group.modelCache.map(patchModel),
            }
          : group,
      ),
    })
  }

  const setModelMappingAction: ChannelStoreActions['setModelMapping'] = async (
    id,
    logicalName,
    upstreamId,
  ) => {
    const ch = await repo.get(id)
    if (!ch) throw new Error(`[channelStore] 渠道不存在：${id}`)
    // 传**当前整张表**进去，由纯函数产出新表：
    // 「空值即删除 / 只补不删 / 去空白」这些口径只有一份实现（domain），
    // 这里再写一遍必然漂移。
    await update(id, { modelMap: setModelMapping(ch.modelMap, logicalName, upstreamId) })
  }

  const setRouteTuning: ChannelStoreActions['setRouteTuning'] = async (id, patch) => {
    const ch = await repo.get(id)
    if (!ch) throw new Error(`[channelStore] 渠道不存在：${id}`)
    await update(id, routeTuningPatch(patch))
  }

  const setRouteStrategy: ChannelStoreActions['setRouteStrategy'] = async (strategy) => {
    const routingPolicy = normalizedRoutingPolicy(store.getState().routingPolicy, { strategy })
    await Promise.all([
      presets.saveRoutingStrategy(strategy),
      routingPolicies.save(routingPolicy),
    ])
    store.setState({ routeStrategy: strategy, routingPolicy })
  }

  const setRoutingPolicy: ChannelStoreActions['setRoutingPolicy'] = async (patch) => {
    const routingPolicy = normalizedRoutingPolicy(store.getState().routingPolicy, patch)
    const legacyStrategy = legacyRouteStrategyFor(routingPolicy, store.getState().routeStrategy)
    await Promise.all([
      routingPolicies.save(routingPolicy),
      presets.saveRoutingStrategy(legacyStrategy),
    ])
    store.setState({ routingPolicy, routeStrategy: legacyStrategy })
  }

  const planGenerationRoute: ChannelStoreActions['planGenerationRoute'] = async (opts) => {
    const state = store.getState()
    const hasLocalCli = platform.cli != null
    const channels = tokenlessRoutableChannels(
      state.channels,
      hasLocalCli,
      protocolNeedsNoToken,
    )
    const first = buildRoutePlan(channels, opts, state.routingPolicy)
    if (
      !first.ok ||
      first.plan.strategy !== 'round_robin' ||
      first.plan.cursorModulus <= 1
    ) {
      return first
    }
    const cursor = await routingPolicies.nextCursor(
      opts.logicalModel,
      opts.category,
      first.plan.cursorModulus,
    )
    return buildRoutePlan(channels, opts, state.routingPolicy, cursor)
  }

  const verify: ChannelStoreActions['verify'] = async (id, groupId) => {
    const ch = await repo.get(id)
    if (!ch) return
    // 地址都没填就别发请求：空地址会让 URL 退化成**相对当前页**的路径（`/v1/models`），
    // 而 dev server / SPA 对任意路径都回 200 的 index.html ——「验证通过」会是纯假象。
    if (requiresBaseUrl(ch.protocol, catalog()) && !ch.baseUrl.trim()) {
      store.setState({ verify: { status: 'error', message: '请先填写地址' } })
      return
    }
    store.setState((s) => ({ verify: { ...s.verify, status: 'checking' } }))
    // 延迟必须由**发起方**测：适配器只管通不通，不知道调用方什么时候开始等的。
    // 记的是「一次 verify 往返」的墙钟时间（含 DNS / TLS / 响应体），与用户按按钮的体感一致。
    const startedAt = Date.now()
    const elapsed = () => Date.now() - startedAt
    try {
      const group =
        ch.credentialGroups.length > 0 ? credentialGroupOf(ch, groupId) : undefined
      const groupKey = group ? await credentials.loadByRef(group.credentialRef) : null
      const { apiKey: legacyApiKey, altApiKey: legacyAltApiKey } = await loadKeys(ch)
      const apiKey = groupKey ?? legacyApiKey
      const altApiKey =
        ch.protocol === '65535' && group?.models.every((model) => model.category !== 'chat')
          ? (groupKey ?? legacyAltApiKey)
          : legacyAltApiKey
      const config: ResolvedChannelConfig = {
        ...toSafeConfig(ch, catalog()),
        ...(group
          ? { credentialRef: group.credentialRef, modelCache: group.modelCache }
          : {}),
        apiKey,
        altApiKey,
      }
      const adapter = createChannelAdapter(config, platform)
      const res: VerifyResult = await adapter.verify(config, timeoutSignal(10_000))
      if (res.ok) {
        // **刻意不写 `modelCache`**：拉模型是「拉取模型」按钮的职责（§7.4）。
        // 验证顺带把全集缓存回来，会让「验证」的语义从「这个地址通不通」漂成
        // 「顺便替你把模型也备齐了」——用户按的是验证，不该收到一份他没要的缓存。
        const updated = await repo.update(id, { lastTestAt: Date.now(), lastTestLatency: elapsed() })
        store.setState((s) => ({
          channels: s.channels.map((c) => (c.id === id ? updated : c)),
          verify: { status: 'ok', latency: elapsed() },
        }))
      } else {
        await repo.update(id, { lastTestAt: Date.now(), lastTestLatency: elapsed() })
        store.setState({ verify: { status: 'error', message: res.message ?? describeError(res.error), latency: elapsed() } })
      }
    } catch (e) {
      // 见下方 asAppError 的注释：这里不能只认 `instanceof Error`，
      // 否则平台层抛出的 AppError 字面量会被渲染成「[object Object]」。
      const app = asAppError(e)
      const message = app ? describeError(app) : e instanceof Error ? e.message : String(e)
      store.setState({ verify: { status: 'error', message, latency: elapsed() } })
    }
  }

  const detectProtocol: ChannelStoreActions['detectProtocol'] = async (id, groupId) => {
    const ch = await repo.get(id)
    if (!ch) return null
    // 候选协议都是「打某个真实端点」的协议，没有地址就没有可打的东西。
    // 若放行空地址，请求会变成相对当前页的 `/v1/models`，被 SPA 的 200 兜底页骗过。
    if (!ch.baseUrl.trim()) {
      store.setState({
        detect: { status: 'error', protocol: null, message: '请先填写地址再验证协议' },
      })
      return null
    }
    store.setState({ detect: { status: 'checking', protocol: null } })
    const group =
      ch.credentialGroups.length > 0 ? credentialGroupOf(ch, groupId) : undefined
    const apiKey = group
      ? await credentials.loadByRef(group.credentialRef)
      : ch.credentialRef
        ? await credentials.loadByRef(ch.credentialRef)
        : null
    /**
     * 探测只问一件事：这个地址是不是 OpenAI 兼容 HTTP。
     *
     * 改造前是「逐条协议打一遍、第一个通过即命中」，而 `openai-images` 与
     * `openai-chat` 都打 `/v1/models`，同一个中继必然被两条同时命中，协议落在
     * 哪条全看候选表顺序（M6-16）。现在只剩一条通用模板，变的只是版本段：
     * `/v1` 不行再试 Ark 的 `/api/v3`。
     */
    const template = protocolById('openai-compatible', catalog())
    let lastMessage = ''
    for (const versionPath of PROBE_VERSION_PATHS) {
      const startedAt = Date.now()
      const elapsed = () => Date.now() - startedAt
      // 用探测模板覆盖当前协议：verify 打的是「OpenAI 兼容在这台机器上长什么样」的端点。
      const config: ResolvedChannelConfig = {
        ...toSafeConfig(ch, catalog()),
        protocol: 'openai-compatible',
        protocolDefinition: template ? { ...template, versionPath } : undefined,
      }
      try {
        const adapter = createChannelAdapter({ ...config, apiKey }, platform)
        const res: VerifyResult = await adapter.verify(config, timeoutSignal(10_000))
        if (res.ok) {
          /**
           * 命中即落库。探测事实层面只能说「这是 OpenAI 兼容」，但用户是带着站点
           * 心智来的：填了玉玉的地址却看到协议变成「OpenAI 兼容」会以为选错了。
           * 按 host 反查站点协议，让探测结果与用户认知一致；未知站点回落通用模板。
           * 同时刷新 lastTest*，与「验证地址」共用同一份「上次往返」记录。
           */
          const hit = stationProtocolForUrl(ch.baseUrl, catalog())?.id ?? 'openai-compatible'
          const updated = await repo.update(id, {
            protocol: hit,
            lastTestAt: Date.now(),
            lastTestLatency: elapsed(),
          })
          store.setState((s) => ({
            channels: s.channels.map((c) => (c.id === id ? updated : c)),
            detect: { status: 'ok', protocol: hit },
          }))
          return hit
        }
        lastMessage = res.message ?? describeError(res.error)
      } catch (e) {
        const app = asAppError(e)
        lastMessage = app ? describeError(app) : e instanceof Error ? e.message : String(e)
      }
    }
    store.setState({
      detect: { status: 'error', protocol: null, message: lastMessage || '该地址不像 OpenAI 兼容接口' },
    })
    return null
  }

  const refreshModels: ChannelStoreActions['refreshModels'] = async (id, groupId) => {
    const ch = await repo.get(id)
    if (!ch) return
    store.setState({ models: { status: 'checking' } })
    try {
      const group =
        ch.credentialGroups.length > 0 ? credentialGroupOf(ch, groupId) : undefined
      const apiKey = group
        ? await credentials.loadByRef(group.credentialRef)
        : (await loadKeys(ch)).apiKey
      const altApiKey = group ? null : (await loadKeys(ch)).altApiKey
      const config: ResolvedChannelConfig = {
        ...toSafeConfig(ch, catalog()),
        ...(group
          ? {
              credentialRef: group.credentialRef,
              modelCache: group.modelCache,
            }
          : {}),
        apiKey,
        altApiKey,
      }
      const adapter = createChannelAdapter(config, platform)
      let pulled: ModelCapability[]
      try {
        pulled = await adapter.listModels(config, timeoutSignal(10_000))
      } catch (error) {
        if (ch.protocol !== '65535' || !group) throw error
        const taskDefinition = protocolById('65535-task', catalog())
        const taskConfig: ResolvedChannelConfig = {
          ...config,
          protocol: '65535-task',
          protocolDefinition: taskDefinition,
          baseUrl:
            taskDefinition?.defaultBaseUrl ?? 'https://task-api-1.65535.space',
        }
        pulled = await createChannelAdapter(taskConfig, platform).listModels(
          taskConfig,
          timeoutSignal(10_000),
        )
      }
      const projection = projectRefreshModels({ channel: ch, group, pulled })
      const updated = await repo.update(id, projection.update)
      store.setState((s) => ({
        channels: s.channels.map((c) => (c.id === id ? updated : c)),
        models: { status: 'ok', modelCount: projection.statusModelCount },
      }))
    } catch (e) {
      // 「拉取模型」与「验证地址」是并排的两个按钮、打的是同一个端点。
      // 此前它没有 catch：地址错的时候抛成未捕获拒绝，用户点了按钮**什么反应都没有**。
      const app = asAppError(e)
      const message = app ? describeError(app) : e instanceof Error ? e.message : String(e)
      if (app?.kind === 'channel' && app.detail === 'missingKey') {
        const group =
          ch.credentialGroups.length > 0 ? credentialGroupOf(ch, groupId) : undefined
        const cleared = await repo.update(
          id,
          group
            ? {
                credentialGroups: ch.credentialGroups.map((item) =>
                  item.id === group.id ? { ...item, modelCache: [], models: [] } : item,
                ),
              }
            : { modelCache: [], models: [] },
        )
        store.setState((s) => ({
          channels: s.channels.map((c) => (c.id === id ? cleared : c)),
          models: { status: 'error', message },
        }))
        return
      }
      store.setState({ models: { status: 'error', message } })
    }
  }

  const enabledChannels = (): Channel[] => store.getState().channels.filter((c) => c.enabled)
  /**
   * 默认定点只允许“现在真能发请求”的渠道。
   * 启用但没令牌、也没填地址的内置渠道不能抢默认模型；否则全新库第一次生成
   * 会选到 RunningHub 之类未配置的站点，任务停在 pending。
   *
   * mock 与 CLI 不需要 HTTP 令牌；localhost 端点允许无令牌（本地模型）。
   */
  const routableChannels = (): Channel[] =>
    store.getState().channels.filter((channel) => channelIsRoutable(channel, catalog()))
  const recipes = createRecipeCache({
    presets,
    setState: (partial) => store.setState(partial),
    recipeMemory: () => store.getState().recipeMemory,
    routableChannels,
    now: () => Date.now(),
  })
  const setDefaultRecipe: ChannelStoreActions['setDefaultRecipe'] = recipes.writeDefault
  const rememberRecipeOfChannel: ChannelStoreActions['rememberRecipe'] = recipes.remember
  const setRecipeMemory: ChannelStoreActions['setRecipeMemory'] = recipes.setMemory
  const defaultForNewNode: ChannelStoreActions['defaultForNewNode'] = recipes.defaultForNewNode

  const requests = createChannelRequestOrchestration({
    platform,
    contextRepo,
    generation,
    channels: () => store.getState().channels,
  })

  return {
    ...store,
    load,
    protocolCatalog: catalog,
    createCustomProtocol,
    removeCustomProtocol,
    removeBuiltinProtocol,
    restoreBuiltinProtocols,
    create,
    update,
    remove,
    globalModelsOf,
    globalModelOf,
    addGlobalModel,
    removeGlobalModel,
    setModelUncommon,
    testModelMapping,
    reorder,
    saveToken: credentials.saveToken,
    loadToken: credentials.loadToken,
    removeToken: credentials.removeToken,
    addCredentialGroup: credentials.addCredentialGroup,
    renameCredentialGroup: credentials.renameCredentialGroup,
    setCredentialGroupPriority: credentials.setCredentialGroupPriority,
    removeCredentialGroup: credentials.removeCredentialGroup,
    saveCredentialGroupToken: credentials.saveCredentialGroupToken,
    loadCredentialGroupToken: credentials.loadCredentialGroupToken,
    removeCredentialGroupToken: credentials.removeCredentialGroupToken,
    setEnabled,
    setModels,
    setModelCategory,
    setModelMapping: setModelMappingAction,
    setRouteTuning,
    setRouteStrategy,
    setRoutingPolicy,
    planGenerationRoute,
    hasToken: credentials.hasToken,
    verify,
    detectProtocol,
    refreshModels,
    enabledChannels,
    rememberRecipe: rememberRecipeOfChannel,
    setRecipeMemory,
    setDefaultRecipe,
    defaultForNewNode,
    completeWithTools: requests.completeWithTools,
    generateSpeech: requests.generateSpeech,
    generateVideo: requests.generateVideo,
  }
}
