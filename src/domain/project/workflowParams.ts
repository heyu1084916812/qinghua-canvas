/**
 * 工作流渠道的参数模型（对账 #1104 / #1106 / #1107）。
 *
 * ## 这份文件解决什么
 *
 * 用户 2026-11-14 的口径：**在设置页里新增一类「工作流渠道」**（先做 RunningHub 云端，
 * 以后把**本地 ComfyUI** 也当同一类渠道接进来 —— 两者只差"执行端在云上还是在本机"），
 * 并且工作流的**可动参数**要能"暴露 / 隐藏"：只把暴露出来的摆到生成节点上，
 * 隐藏的照工作流自己的默认值走、不下发。
 *
 * ## 关键事实（不是设计选择，是上游行为）
 *
 * RunningHub 的 `POST /api/openapi/getJsonApiFormat {apiKey, workflowId}` 会把**整份工作流
 * JSON** 回来（`data.prompt`，字符串）：每个节点的 `inputs` 就是"这次能改的全部参数"，
 * 而且**没有任何"哪些对外开放"的元信息** —— 这一点与「AI 应用」不同（应用的开放字段
 * 由作者在网页端勾好，接口只回那几个）。所以在工作流这条路上，
 * **"暴露 / 隐藏"只能是轻画自己的配置**，默认值必须是**全部隐藏**：
 * 默认全开等于把作者没打算外露的内部参数（分辨率、采样器、内部开关）一股脑倒在节点上，
 * 用户改错一个就跑坏，且节点会被塞爆。
 *
 * ## 分层
 *
 * 这里只有**纯数据 + 纯函数**：解析工作流 JSON、归一化用户配置、算提交体、算随机种子。
 * 发请求是平台层的事（`platform/channels/runninghubWorkflow.ts`），画界面是 UI 的事。
 */

/** 执行端：先只支持云端 RunningHub，本地 ComfyUI 留同构的口子（用户 2026-11-14 口径） */
export type WorkflowProviderKind = 'runninghub' | 'comfyui-local'

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
}

/** 工作流渠道里的一个条目（= 节点模型下拉里的一行） */
export interface WorkflowEntry {
  /** RunningHub 的 workflowId（本地 ComfyUI 时是工作流文件名 / 标识） */
  id: string
  title: string
  provider: WorkflowProviderKind
  fields: WorkflowParamField[]
  /** 最近一次拉到参数的时间（毫秒）；0 = 从没拉过 */
  fetchedAt: number
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

/**
 * 条目清单存在 `presets` 表的哪一行（按渠道分开）。
 *
 * 与「CLI 工具配置」同一条理由（`state/project/cliToolStore.ts`）：`presets` 就是
 * 「按 id 存一条 JSON」，新建表要动 Dexie schema，为一份同构的配置付这个代价不值得。
 */
export const WORKFLOW_ENTRIES_ROW_PREFIX = 'workflow:entries:'

export function workflowEntriesRowId(channelId: string): string {
  return `${WORKFLOW_ENTRIES_ROW_PREFIX}${channelId}`
}

/** `inputs` 里的「连线值」：`["<上游 nodeId>", 输出槽位号]` —— 它是连接，不是参数 */
export function isWorkflowLinkValue(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === 'string' &&
    typeof value[1] === 'number'
  )
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
    out.push({
      id,
      title: str(record.title).trim() || id,
      provider,
      fields,
      fetchedAt: Number.isFinite(Number(record.fetchedAt)) ? Number(record.fetchedAt) : 0,
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
    return {
      ...fresh,
      label: kept.label,
      type: kept.type,
      enabled: kept.enabled,
      options: kept.options,
      min: kept.min,
      max: kept.max,
      step: kept.step,
      seed: kept.seed,
      required: kept.required,
    }
  })
}

/**
 * 字段的取值 / 必填校验 / 种子归一 / 提交体在 `workflowParamValues.ts`
 * —— 那份是「这一次发什么」，这份是「字段表怎么来、怎么存、怎么合并」。
 */

