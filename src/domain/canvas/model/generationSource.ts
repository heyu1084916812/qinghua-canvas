import type { GenerationData } from './node'

/**
 * 生成节点的**来源**（用户 2026-11-15 拍板的「模型菜单内嵌来源切换」，对账 #1133）。
 *
 * - `api`：渠道里的普通模型（显示名 → 选路 → 渠道适配器）；
 * - `workflow`：RunningHub 导入的 AI 应用 / 工作流条目（`app:<id>` / `workflow:<id>`）；
 * - `cli`：本机 CLI 工具（`cli:<toolId>`，执行期合成一条 CLI 渠道直接起子进程）。
 *
 * ## 为什么来源要**存在节点上**
 *
 * `app:` 前缀有两种身份：导入过的应用条目是「工作流」来源，渠道推荐的 `app:` 模型却是
 * 普通 API 模型（#1128 H3）。只靠前缀推不出来，所以选中时把来源写进 `data.source`；
 * 老节点没有这一字段时才按前缀 / 渠道协议推断（`inferSource`）。
 *
 * ## 参数按来源分开存
 *
 * 顶层字段只放**当前来源**的参数（API 的比例 / 清晰度…，工作流的提交体 / 实例规格）；
 * 切走时把当前来源的那一份收进 `sourceSlots[来源]`，切回来再放回顶层。
 * 这样提交体只会带当前来源的参数（`generationParams` 也按来源再挡一道）。
 */
export type GenerationSource = 'api' | 'workflow' | 'cli'

export const GENERATION_SOURCES: readonly GenerationSource[] = ['api', 'workflow', 'cli']

export const SOURCE_LABELS: Record<GenerationSource, string> = { api: 'API', workflow: '工作流', cli: 'CLI' }

/** CLI 来源的模型 id 前缀：`cli:<toolId>`（toolId 见 `domain/shared/cliTools`） */
export const CLI_MODEL_PREFIX = 'cli:'

/** 一个来源「上次选的项 + 它自己的参数」 */
export interface SourceSlot {
  model: string
  channelId: string
  params: Partial<GenerationData>
}

export type SourceSlots = Partial<Record<GenerationSource, SourceSlot>>

/** API 来源独有的参数（与 `newNodePreset.GENERATION_PARAM_KEYS` 同一批，外加超分倍率 / 帧率） */
export const API_PARAM_KEYS = [
  'ratio', 'resolution', 'quality', 'scale', 'background', 'count', 'size', 'durationSec', 'fps',
  'refMode', 'videoMode', 'generateAudio', 'mjStylize', 'mjWeird', 'mjChaos', 'mjPersonalize',
] as const satisfies readonly (keyof GenerationData)[]

/** 工作流来源独有的参数：暴露字段提交体 + 实例规格 */
export const WORKFLOW_PARAM_KEYS = ['workflowNodeInfoList', 'workflowInstance'] as const satisfies readonly (keyof GenerationData)[]

/** CLI 来源的参数就是本机工具的参数模板（存在全局 CLI 设置里），节点上不另存 */
const SOURCE_PARAM_KEYS: Record<GenerationSource, readonly (keyof GenerationData)[]> = {
  api: API_PARAM_KEYS,
  workflow: WORKFLOW_PARAM_KEYS,
  cli: [],
}

export function sourceParamKeys(source: GenerationSource): readonly (keyof GenerationData)[] {
  return SOURCE_PARAM_KEYS[source]
}

export function isGenerationSource(value: unknown): value is GenerationSource {
  return value === 'api' || value === 'workflow' || value === 'cli'
}

export function cliModelId(toolId: string): string {
  return `${CLI_MODEL_PREFIX}${toolId}`
}

/** `cli:jimeng` → `jimeng`；不是 CLI 模型返回 null */
export function toolIdOfCliModel(model: string | undefined): string | null {
  const text = String(model ?? '')
  if (!text.startsWith(CLI_MODEL_PREFIX)) return null
  const id = text.slice(CLI_MODEL_PREFIX.length).trim()
  return id === '' ? null : id
}

/** 只有 API 来源能出现在「新建节点默认」与 Agent 生成里（条目 / CLI 要用户在节点上自己挑） */
export const NON_API_MODEL = /^(workflow|app|cli):/

/**
 * 由模型 id 推来源（**不看节点字段**）：`workflow:` → 工作流、`cli:` → CLI、其余 API。
 *
 * `app:` 在这里**按 API 算**：它是不是导入过的条目，要看条目表（面板侧 `inferSource` 传
 * `isEntryModel` 进来判），纯前缀判不出。
 */
export function sourceOfModel(model: string | undefined): GenerationSource {
  const text = String(model ?? '')
  if (text.startsWith('workflow:')) return 'workflow'
  if (text.startsWith(CLI_MODEL_PREFIX)) return 'cli'
  return 'api'
}

export interface SourceInferenceContext {
  /** 这个 `app:` / `workflow:` 模型是不是导入过的条目（面板按条目表回答；不知道时别传） */
  isEntryModel?: (model: string, channelId: string) => boolean
  /** 这条渠道是不是本机 CLI 协议（老数据：CLI 渠道 + 工具逻辑名） */
  isCliChannel?: (channelId: string) => boolean
}

/**
 * 老节点（没有 `data.source`）该归到哪个来源（对账 #1133 逻辑 5）。
 *
 * - `workflow:` 一律是工作流（条目丢了也要在工作流参数行里说清楚）；
 * - `app:` 只有导入过的条目才是工作流，推荐应用仍是 API；
 * - `cli:` 或「渠道是本机 CLI 协议」的老节点是 CLI；
 * - 其余 API。
 */
export function inferSource(
  data: Pick<GenerationData, 'model' | 'channelId'>,
  context: SourceInferenceContext = {},
): GenerationSource {
  const model = String(data.model ?? '')
  const channelId = String(data.channelId ?? '')
  if (model.startsWith('workflow:')) return 'workflow'
  if (model.startsWith('app:')) return context.isEntryModel?.(model, channelId) ? 'workflow' : 'api'
  if (model.startsWith(CLI_MODEL_PREFIX)) return 'cli'
  if (channelId && context.isCliChannel?.(channelId)) return 'cli'
  return 'api'
}

/** 节点当前来源：存了就以存的为准，没存再推断 */
export function nodeSource(
  data: Pick<GenerationData, 'model' | 'channelId' | 'source'>,
  context: SourceInferenceContext = {},
): GenerationSource {
  return isGenerationSource(data.source) ? data.source : inferSource(data, context)
}

function pickParams(data: Partial<GenerationData>, keys: readonly (keyof GenerationData)[]): Partial<GenerationData> {
  const out: Partial<GenerationData> = {}
  for (const key of keys) {
    const value = data[key]
    if (value !== undefined) (out as Record<string, unknown>)[key] = value
  }
  return out
}

/** 这个来源上次选的那一项（当前来源读顶层，其它来源读 `sourceSlots`） */
export function sourceSlotOf(
  data: Pick<GenerationData, 'model' | 'channelId' | 'source' | 'sourceSlots'> & Partial<GenerationData>,
  source: GenerationSource,
  context: SourceInferenceContext = {},
): SourceSlot | null {
  if (nodeSource(data, context) === source) {
    return data.model ? { model: data.model, channelId: data.channelId ?? '', params: pickParams(data, sourceParamKeys(source)) } : null
  }
  return data.sourceSlots?.[source] ?? null
}

export interface SourcePick {
  source: GenerationSource
  model: string
  channelId: string
  /** 换成一个**新**条目时它自己的默认参数（工作流：默认提交体）；同一项切回时被存档覆盖 */
  defaults?: Partial<GenerationData>
}

/**
 * 在菜单里点了一项 → 节点补丁（对账 #1133 逻辑 1 / 2 / 3）。
 *
 * - **同来源**换一项：只换模型 / 渠道；工作流换了条目就换成新条目的默认提交体
 *   （旧条目填过的值不串门，#1128 口径）。
 * - **跨来源**：当前来源的模型 + 参数收进 `sourceSlots`，顶层这些参数清掉；
 *   目标来源有存档就放回 —— API 的参数通用，总是放回；工作流只有选的还是存档里那一项才放回
 *   （换了条目就用新条目默认）；CLI 没有节点级参数。
 */
export function switchSourcePatch(
  data: Pick<GenerationData, 'model' | 'channelId' | 'source' | 'sourceSlots'> & Partial<GenerationData>,
  pick: SourcePick,
  context: SourceInferenceContext = {},
): Partial<GenerationData> {
  const current = nodeSource(data, context)
  const target = pick.source
  const base: Partial<GenerationData> = { source: target, model: pick.model, channelId: pick.channelId }
  if (current === target) {
    const entryChanged = target === 'workflow' && pick.model !== data.model
    return entryChanged ? { ...base, ...cleared(WORKFLOW_PARAM_KEYS), ...(pick.defaults ?? {}) } : base
  }
  const slots: SourceSlots = { ...(data.sourceSlots ?? {}) }
  if (data.model) {
    slots[current] = { model: data.model, channelId: data.channelId ?? '', params: pickParams(data, sourceParamKeys(current)) }
  }
  const saved = slots[target]
  const restore =
    saved && (target === 'api' || saved.model === pick.model) ? saved.params : (pick.defaults ?? {})
  return { ...cleared(sourceParamKeys(current)), ...restore, ...base, sourceSlots: slots }
}

function cleared(keys: readonly (keyof GenerationData)[]): Partial<GenerationData> {
  return Object.fromEntries(keys.map((key) => [key, undefined])) as Partial<GenerationData>
}
