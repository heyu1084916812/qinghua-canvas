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
  entries: WorkflowEntry[]
}

export interface WorkflowPanelSources {
  channels: WorkflowPanelChannel[]
}

export function workflowChannelsOf(sources: WorkflowPanelSources | null | undefined): WorkflowPanelChannel[] {
  return sources?.channels.filter((channel) => channel.entries.length > 0) ?? []
}
