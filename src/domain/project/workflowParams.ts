/** 工作流渠道的参数模型：解析工作流 JSON、归一化用户配置并生成提交体。
 * 只保留纯数据与纯函数；网络请求由 platform/channels 负责，界面由 workbenches 负责。
 */

import { isWorkflowLinkValue, normalizeWorkflowGraph, type WorkflowGraph } from './workflowGraph'

export { isWorkflowLinkValue }

/** 执行端：先只支持云端 RunningHub，本地 ComfyUI 留同构的口子（用户 2026-11-14 口径） */
export type WorkflowProviderKind = 'runninghub' | 'comfyui-local'

/** 可选媒体没有上游素材时的提交口径。skip 保留节点默认值；prune-workflow 删除该输入。 */
export type WorkflowMediaPolicy = 'skip' | 'prune-workflow'

export interface WorkflowProviderSpec {
  id: WorkflowProviderKind
  label: string
  /** 取值 / 用法的出处（没出处就不写，宁缺勿编） */
  docUrl: string
  note: string
}

export const WORKFLOW_PROVIDERS: readonly WorkflowProviderSpec[] = [
  {
    id: 'runninghub',
    label: 'RunningHub 云端',
    docUrl: 'https://www.runninghub.cn/call-api/standard-api',
    note: '填你的 workflowId 与 API Key，拉一次参数就能勾选暴露哪些；扣的是「金额」余额。',
  },
  {
    id: 'comfyui-local',
    label: '本地 ComfyUI',
    docUrl: 'https://github.com/comfyanonymous/ComfyUI',
    note: '同一套参数模型，执行端换成局域网里的 ComfyUI（本机 / 同网段地址），不走上游余额。',
  },
]

export function isWorkflowProvider(value: unknown): value is WorkflowProviderKind {
  return WORKFLOW_PROVIDERS.some((p) => p.id === value)
}

export function workflowProviderLabel(kind: WorkflowProviderKind): string {
  return WORKFLOW_PROVIDERS.find((p) => p.id === kind)?.label ?? kind
}

/**
 * 参数控件类型。
 *
 * `select` 与数字的 `min/max/step` **推不出来**：工作流 JSON 里 `inputs` 只有值，没有候选集
 * （候选集在 ComfyUI 节点定义里，不在 API 格式里）。所以这里推出来的只是**起点**，
 * 用户在参数面板里改成下拉 / 数字范围即可 —— 这与参考项目用一份 `*.config.json`
 * 人工声明是同一个道理（见调研文档 §2.1）。
 */
export type WorkflowParamType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'boolean'
  | 'select'
  | 'image'
  | 'video'
  | 'audio'

export interface WorkflowParamField {
  /** `"<nodeId>::<fieldName>"` —— 同时是持久化键与 React key */
  id: string
  nodeId: string
  fieldName: string
  type: WorkflowParamType
  /** 节点上显示的名字（用户可改；默认取字段名） */
  label: string
  /** 工作流里的现值（也是"没填过"时的默认值） */
  value: string
  /**
   * **是否暴露到生成节点**。默认 `false` —— 见文件头：上游不给"哪些该开放"，
   * 默认全开是错的。
   */
  enabled: boolean
  /** 分组（取自节点标题 / class_type），面板里按它分块 */
  group: string
  /** `select` 的候选值；空数组 = 不是下拉 */
  options: string[]
  min: number | null
  max: number | null
  step: number | null
  /** 种子类字段：节点上给「随机」按钮，且提交前按 32 位无符号归一 */
  seed: boolean
  /** 必填：暴露了却没值就拦在提交前，别让服务端替你报一句看不懂的话 */
  required: boolean
  /** 同一节点有多个媒体槽时，按这个顺序取上游素材 */
  mediaOrder: number
  /** 用户在编辑器里**手动改过类型**：重新拉取时保留它；没改过就采用新推断（#1129 M6） */
  typeEdited?: boolean
}

/** 工作流渠道里的一个条目（= 节点模型下拉里的一行） */
export interface WorkflowEntry {
  /** RunningHub 的 workflowId / AI 应用的 webappId（本地 ComfyUI 时是工作流文件名 / 标识） */
  id: string
  title: string
  provider: WorkflowProviderKind
  /** 条目类型：工作流 / AI 应用（同一个清单里两栏展示，执行时用不同前缀） */
  kind?: 'workflow' | 'app'
  /** 备注（用户可写用途 / 参数说明） */
  note?: string
  /** 输出类型（工作流设置页可改；缺省按暴露媒体推断） */
  outputKind?: 'image' | 'video'
  fields: WorkflowParamField[]
  /**
   * 节点图快照（`getJsonApiFormat` 的 `prompt` 抽出来的节点与连线）。
   *
   * 设置页条目设置区要**点开就画**，所以随条目一起存（只留画图要用的那几个字段）；
   * 老条目没有这一份时退回「按节点分组的参数清单」—— 不因为缺图就整块不能编辑。
   */
  graph?: WorkflowGraph
  /** ComfyUI 执行所需的原始 prompt graph；只对本地 ComfyUI 条目保存。 */
  workflowJson?: Record<string, unknown>
  /** 可选媒体没有上游素材时的提交口径；老条目默认 skip。 */
  mediaPolicy?: WorkflowMediaPolicy
  /** 最近一次拉到参数的时间（毫秒）；0 = 从没拉过 */
  fetchedAt: number
  /**
   * 封面图地址（只有 AI 应用有 —— `apiCallDemo` 的 `covers[]`）。
   *
   * 存下来而不每次现拉：条目清单在设置页要能"一眼认出是哪个应用"，
   * 而拉一次封面要一次网络请求 + 上游那张图可能很大（`thumbnailUri` 更小，但都要联网）。
   */
  coverUrl?: string
}

/**
 * 条目 → 节点模型下拉里的 id。
 *
 * 前缀沿用 RunningHub 适配器既有的 `app:` 思路（见 `platform/channels/runninghub.ts`）：
 * 模型 id 就是**条目身份**，不是上游模型名，所以路由层不需要理解工作流。
 */
export const WORKFLOW_MODEL_PREFIX = 'workflow:'

export function workflowModelId(entryId: string): string {
  return `${WORKFLOW_MODEL_PREFIX}${entryId}`
}

export function workflowEntryIdOf(modelId: string): string | null {
  if (!modelId.startsWith(WORKFLOW_MODEL_PREFIX)) return null
  const id = modelId.slice(WORKFLOW_MODEL_PREFIX.length).trim()
  return id || null
}

/** AI 应用的模型 id 前缀（与应用作者暴露字段那条路同源） */
export const APP_MODEL_PREFIX = 'app:'

/**
 * 模型 id → 条目 id（工作流 `workflow:` 与 AI 应用 `app:` 两种前缀都认）。
 *
 * 面板只知道「这一格是某个条目的模型 id」；两栏（应用 / 工作流）在设置页是分开的，
 * 在执行与参数渲染上是同一条路 —— 认这两条前缀的只有这一个函数。
 */
export function entryIdOfModel(modelId: string): string | null {
  const workflow = workflowEntryIdOf(modelId)
  if (workflow) return workflow
  if (!modelId.startsWith(APP_MODEL_PREFIX)) return null
  const id = modelId.slice(APP_MODEL_PREFIX.length).trim()
  return id || null
}

/**
 * 条目清单存在 `presets` 表的哪一行（按渠道分开）。
 * 与「CLI 工具配置」同一条理由（`state/project/cliToolStore.ts`）：`presets` 就是
 * 「按 id 存一条 JSON」，新建表要动 Dexie schema，为一份同构的配置付这个代价不值得。
 */
export const WORKFLOW_ENTRIES_ROW_PREFIX = 'workflow:entries:'

export function workflowEntriesRowId(channelId: string): string {
  return `${WORKFLOW_ENTRIES_ROW_PREFIX}${channelId}`
}

const MEDIA_KEYS: Record<'image' | 'video' | 'audio', RegExp> = {
  image: /(?:^|[^a-z])(image|img|mask|photo|picture|frame)s?(?:[^a-z]|$)/i,
  video: /(?:^|[^a-z])(video|movie|clip)s?(?:[^a-z]|$)/i,
  audio: /(?:^|[^a-z])(audio|sound|music|voice|tts)s?(?:[^a-z]|$)/i,
}

const MEDIA_EXT: Record<'image' | 'video' | 'audio', RegExp> = {
  image: /\.(png|jpe?g|webp|gif|bmp)(\?|$)/i,
  video: /\.(mp4|webm|mov|m4v|mkv)(\?|$)/i,
  audio: /\.(mp3|wav|ogg|m4a|flac|aac)(\?|$)/i,
}

/** 种子类字段名的判据：命中就按 32 位无符号归一并给「随机」按钮 */
const SEED_NAME = /(^|[^a-z])(seed|noise_seed|randoms?eed)([^a-z]|$)/i

export function isSeedFieldName(fieldName: string): boolean {
  return SEED_NAME.test(fieldName)
}

/**
 * 从「字段名 + 当前值」猜控件类型。
 *
 * 只做**能确定的那几档**：媒体按名字 / 扩展名、布尔按 `true`/`false`、数字按可解析。
 * 推不出的一律 `text` —— 包括下拉：**候选集不在 API 格式里**，猜一个只会让用户
 * 看到一份假选项。
 */
export function inferWorkflowParamType(fieldName: string, value: string): WorkflowParamType {
  const key = fieldName ?? ''
  const text = (value ?? '').trim()
  /**
   * **布尔先判**：`use_custom_audio` 这类名字里带媒体词的可动参数是开关，
   * 先按名字判媒体会把它认成一条音频槽 —— 用户在节点上看到的是"上传音频"，
   * 而这个参数实际只吃 `true` / `false`（实测踩过一次）。
   */
  if (/^(true|false)$/i.test(text)) return 'boolean'
  /**
   * `clip_name` 是 **CLIP 模型文件名**（CLIPLoader），不是视频片段。
   * 视频那条正则里有 `clip`，真拉 Z-Image 时把 `18::clip_name` 认成了「视频」，
   * 节点图上就多出一个"视频输入"—— 这是字段名误判，不是上游真有视频口。
   */
  if (/^clip(?:_|$)/i.test(key)) return 'text'
  /** 数字先于媒体（#1129 M6：`frame_rate=24`、`mask_blur=4` 被认成媒体槽）；媒体槽的值是文件名，不会是数 */
  if (text !== '' && Number.isFinite(Number(text))) return 'number'
  for (const kind of ['image', 'video', 'audio'] as const) {
    if (MEDIA_KEYS[kind].test(key) || MEDIA_EXT[kind].test(text)) return kind
  }
  if (text !== '' && Number.isFinite(Number(text))) return 'number'
  return 'text'
}

function str(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return fallback
}

function numOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value)
  }
  return null
}

function optionsOf(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[\r\n,]+/)
      : []
  const out: string[] = []
  for (const item of raw) {
    const text = str(item).trim()
    if (text && !out.includes(text)) out.push(text)
  }
  return out
}

/**
 * 工作流 JSON → 参数字段表（**默认全部隐藏**）。
 *
 * `workflowJson` 是 `getJsonApiFormat` 里 `data.prompt` 解析出来的对象：
 * `{ "<nodeId>": { class_type, _meta?: {title}, inputs: {...} }, ... }`。
 * 连线值（`["12", 0]`）跳过 —— 它是连接，改它会改变图结构，不是"调参数"。
 */
export function parseWorkflowJsonToFields(workflowJson: unknown): WorkflowParamField[] {
  if (!workflowJson || typeof workflowJson !== 'object' || Array.isArray(workflowJson)) return []
  const fields: WorkflowParamField[] = []
  const seen = new Set<string>()
  const mediaCount = new Map<string, number>()
  for (const [nodeId, rawNode] of Object.entries(workflowJson as Record<string, unknown>)) {
    if (!rawNode || typeof rawNode !== 'object') continue
    const node = rawNode as { inputs?: unknown; class_type?: unknown; _meta?: unknown }
    const inputs = node.inputs
    if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) continue
    const meta = node._meta as { title?: unknown } | undefined
    const group = str(meta?.title).trim() || str(node.class_type).trim() || nodeId
    for (const [fieldName, rawValue] of Object.entries(inputs as Record<string, unknown>)) {
      if (isWorkflowLinkValue(rawValue)) continue
      const id = `${nodeId}::${fieldName}`
      if (seen.has(id)) continue
      seen.add(id)
      const value = Array.isArray(rawValue) || (rawValue && typeof rawValue === 'object')
        ? JSON.stringify(rawValue)
        : str(rawValue)
      const type = inferWorkflowParamType(fieldName, value)
      const media = type === 'image' || type === 'video' || type === 'audio'
      const order = media ? (mediaCount.get(type) ?? 0) : 0
      if (media) mediaCount.set(type, order + 1)
      fields.push({
        id,
        nodeId,
        fieldName,
        type,
        label: fieldName,
        value,
        /* 默认隐藏：见文件头 —— 上游不给"哪些该开放"，默认全开是错的 */
        enabled: false,
        group,
        options: [],
        min: type === 'number' ? null : null,
        max: null,
        step: type === 'number' ? 1 : null,
        seed: isSeedFieldName(fieldName),
        required: media,
        mediaOrder: order,
      })
    }
  }
  return fields
}

/**
 * 存回来的配置 → 字段表（坏值一律回落，不抛）。
 *
 * 「工作流 JSON 变了、字段没了」不在这里处理：字段表是**用户勾过的快照**，
 * 重新拉参数时会与快照合并（见 `mergeRefetchedFields`），这样用户改过的名字 / 类型 /
 * 暴露状态不会因为再拉一次就全丢。
 */
export function normalizeWorkflowField(raw: unknown): WorkflowParamField | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const nodeId = str(record.nodeId).trim()
  const fieldName = str(record.fieldName).trim()
  if (!nodeId || !fieldName) return null
  const value = str(record.value)
  const type = str(record.type)
  return {
    id: str(record.id).trim() || `${nodeId}::${fieldName}`,
    nodeId,
    fieldName,
    type: isWorkflowParamType(type) ? type : inferWorkflowParamType(fieldName, value),
    label: str(record.label).trim() || fieldName,
    value,
    enabled: record.enabled === true,
    group: str(record.group).trim(),
    options: optionsOf(record.options),
    min: numOrNull(record.min),
    max: numOrNull(record.max),
    step: numOrNull(record.step),
    seed: record.seed === true || isSeedFieldName(fieldName),
    required: record.required === true,
    mediaOrder: Number.isFinite(Number(record.mediaOrder)) ? Math.max(0, Number(record.mediaOrder)) : 0,
    ...(record.typeEdited === true ? { typeEdited: true } : {}),
  }
}

const WORKFLOW_PARAM_TYPES: readonly WorkflowParamType[] = [
  'text',
  'textarea',
  'number',
  'boolean',
  'select',
  'image',
  'video',
  'audio',
]

function isWorkflowParamType(value: string): value is WorkflowParamType {
  return (WORKFLOW_PARAM_TYPES as readonly string[]).includes(value)
}

function normalizeComfyWorkflowJson(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const out: Record<string, unknown> = {}
  for (const [id, value] of Object.entries(raw)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const node = value as Record<string, unknown>
    const inputs = node.inputs && typeof node.inputs === 'object' && !Array.isArray(node.inputs) ? { ...(node.inputs as Record<string, unknown>) } : {}
    const classType = typeof node.class_type === 'string' ? node.class_type : ''
    if (!classType) continue
    out[id] = { class_type: classType, inputs, ...(node._meta !== undefined ? { _meta: node._meta } : {}) }
  }
  return Object.keys(out).length ? out : undefined
}

export function normalizeWorkflowEntries(raw: unknown): WorkflowEntry[] {
  if (!Array.isArray(raw)) return []
  const out: WorkflowEntry[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const id = str(record.id).trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    const provider = isWorkflowProvider(record.provider) ? record.provider : 'runninghub'
    const fields = Array.isArray(record.fields)
      ? record.fields
          .map((field) => normalizeWorkflowField(field))
          .filter((field): field is WorkflowParamField => field !== null)
      : []
    const coverUrl = str(record.coverUrl).trim()
    const note = str(record.note).trim()
    const kind = record.kind === 'app' ? 'app' : 'workflow'
    const outputKind = record.outputKind === 'video' ? 'video' : record.outputKind === 'image' ? 'image' : undefined
    const mediaPolicy = record.mediaPolicy === 'prune-workflow' ? 'prune-workflow' : 'skip'
    const graph = normalizeWorkflowGraph(record.graph)
    const workflowJson = normalizeComfyWorkflowJson(record.workflowJson)
    out.push({
      id,
      title: str(record.title).trim() || id,
      provider,
      kind,
      ...(note ? { note } : {}),
      ...(outputKind ? { outputKind } : {}),
      ...(mediaPolicy === 'prune-workflow' ? { mediaPolicy } : {}),
      fields,
      ...(graph ? { graph } : {}),
      ...(workflowJson ? { workflowJson } : {}),
      fetchedAt: Number.isFinite(Number(record.fetchedAt)) ? Number(record.fetchedAt) : 0,
      ...(coverUrl ? { coverUrl } : {}),
    })
  }
  return out
}

/**
 * 重新拉参数：以**新拉到的字段**为准，但保留用户对同名字段的配置（暴露与否 / 名字 / 类型 / 范围）。
 *
 * 为什么必须合并而不是替换：拉参数是「同步上游」的动作，用户可能只是加了一个节点想再同步一次；
 * 直接替换会把之前勾好的 20 个暴露项清空、名字全变回英文 input 名 —— 那是"同步"变成"重置"。
 */
export function mergeRefetchedFields(
  previous: readonly WorkflowParamField[],
  refetched: readonly WorkflowParamField[],
): WorkflowParamField[] {
  const byId = new Map(previous.map((field) => [field.id, field]))
  return refetched.map((fresh) => {
    const kept = byId.get(fresh.id)
    if (!kept) return fresh
    /** 类型：手动改过才保留，否则采用新推断，旧误判能自愈；类型换了必填跟新的走（#1129 M6） */
    const keepType = kept.typeEdited === true
    return {
      ...fresh,
      label: kept.label,
      type: keepType ? kept.type : fresh.type,
      ...(keepType ? { typeEdited: true } : {}),
      enabled: kept.enabled,
      options: kept.options,
      min: kept.min,
      max: kept.max,
      step: kept.step,
      seed: kept.seed,
      required: keepType || kept.type === fresh.type ? kept.required : fresh.required,
    }
  })
}

