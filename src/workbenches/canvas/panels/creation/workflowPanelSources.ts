import { entryIdOfModel, workflowModelId, type WorkflowEntry } from '../../../../domain/project/workflowParams'

/**
 * 创作面板能选到的「工作流来源」：RunningHub 渠道 + 各自的工作流条目。
 *
 * 由 `PanelLayer` 侧装配（它有渠道店与存储），面板只负责画 —— 面板本身不认识
 * 「RunningHub 协议」这件事，与现有「面板只认模型 id」的边界一致。
 */
export interface WorkflowPanelChannel {
  id: string
  name: string
  /**
   * 渠道协议（`runninghub-api` 等）—— 只用来画 chip 前面那枚品牌图标。
   *
   * 面板不认识「RunningHub」，认识的是「这条渠道有品牌图标」；
   * 与设置页那张 `ChannelIcon` 共用同一份映射。
   */
  protocol: string
  /** 渠道地址：用来分国内站 / 国际站（面板副标题） */
  baseUrl?: string
  entries: WorkflowEntry[]
}

export interface WorkflowPanelSources {
  channels: WorkflowPanelChannel[]
  /** 条目已读完（读完之前「app: 是不是导入过的条目」判不出，别据此给老节点补写来源，#1133） */
  loaded?: boolean
}

/** 条目 → 节点上存的模型 id（AI 应用是 `app:` 前缀，工作流是 `workflow:`） */
export function workflowEntryModelId(entry: WorkflowEntry): string {
  return entry.kind === 'app' ? `app:${entry.id}` : workflowModelId(entry.id)
}

/** RunningHub 两站：`runninghub.ai` 是国际站，其余（`.cn` / 自定义）按国内站 */
export function runninghubSiteOf(baseUrl: string | undefined): string {
  return /runninghub\.ai/i.test(String(baseUrl ?? '')) ? '国际站' : '国内站'
}

export function workflowChannelsOf(sources: WorkflowPanelSources | null | undefined): WorkflowPanelChannel[] {
  return sources?.channels.filter((channel) => channel.entries.length > 0) ?? []
}

/**
 * 渠道表 → 要读条目的渠道 id（只有 RunningHub 这一种协议有「AI 应用 / 工作流」）。
 *
 * 单独拎出来是因为它踩过一次坑：上一版把依赖用的 `|tick` 后缀拼进同一个字符串
 * 再 `split(',')`，拆出来的 id 带着后缀，`load()` 永远读不到条目。
 */
export function runninghubChannelIds(
  channels: readonly { id: string; protocol: string }[],
): string[] {
  return channels.filter((channel) => channel.protocol === 'runninghub-api').map((channel) => channel.id)
}

/** 一条可选来源：哪个渠道下的哪个条目 */
export interface WorkflowSourceRow {
  channelId: string
  channelName: string
  protocol: string
  entry: WorkflowEntry
}

export function workflowSourceRows(sources: WorkflowPanelSources | null | undefined): WorkflowSourceRow[] {
  return workflowChannelsOf(sources).flatMap((channel) =>
    channel.entries.map((entry) => ({ channelId: channel.id, channelName: channel.name, protocol: channel.protocol, entry })),
  )
}

/**
 * 节点模型对应的条目行；**找不到就是 null**（#1128 H3：上一版落到 `rows[0]`，
 * 显示并编辑的是另一个条目）。前缀要和条目种类对上：`app:` 只认应用条目、`workflow:` 只认工作流。
 */
export function findWorkflowSourceRow(
  sources: WorkflowPanelSources | null | undefined,
  model: string | undefined,
  channelId: string | undefined,
): WorkflowSourceRow | null {
  const text = String(model ?? '')
  const kind = text.startsWith('app:') ? 'app' : text.startsWith('workflow:') ? 'workflow' : null
  const id = kind ? entryIdOfModel(text) : null
  if (!kind || !id) return null
  const rows = workflowSourceRows(sources).filter((row) => row.entry.id === id && (row.entry.kind ?? 'workflow') === kind)
  return rows.find((row) => row.channelId === channelId) ?? rows[0] ?? null
}

/**
 * 面板该不该进「工作流模式」：`workflow:` 一律进（条目丢了也要在这一行说清楚，而不是露出 API 控件）；
 * `app:` **只有导入过的应用条目**才进 —— 渠道推荐的 `app:` 模型不是条目，按普通模型走 API 参数行。
 */
export function isWorkflowPanelModel(
  sources: WorkflowPanelSources | null | undefined,
  model: string | undefined,
  channelId: string | undefined,
): boolean {
  if (!sources) return false
  const text = String(model ?? '')
  if (text.startsWith('workflow:')) return true
  return text.startsWith('app:') && findWorkflowSourceRow(sources, text, channelId) !== null
}
