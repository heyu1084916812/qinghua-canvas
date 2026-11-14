import type { WorkflowEntry } from '../../../../domain/project/workflowParams'

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
  entries: WorkflowEntry[]
}

export interface WorkflowPanelSources {
  channels: WorkflowPanelChannel[]
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
