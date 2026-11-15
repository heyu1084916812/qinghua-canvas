import type { PlatformKit } from '../../platform/ports'
import type { ChannelStore } from '../../state/channel/channelStore'
import { queryWorkflowTask } from '../../platform/channels/runninghubWorkflow'

export type RecheckOutcome =
  | { kind: 'done'; text: string }
  | { kind: 'pending'; text: string }
  | { kind: 'failed'; text: string }

/**
 * 「再查一次」（#1130 M10.1）：停止等待之后任务还在上游跑、已经计费，凭任务 id **只查一次**
 * v2 `query`，不重新提交（提交才扣积分，查询不扣）。
 */
export async function recheckWorkflowTask(
  deps: Pick<PlatformKit, 'network'>,
  endpoint: { host: string; apiKey: string },
  taskId: string,
  signal: AbortSignal,
): Promise<RecheckOutcome> {
  const task = await queryWorkflowTask(deps, endpoint, taskId, signal)
  if (task.status === 'SUCCESS') {
    return task.urls.length > 0
      ? { kind: 'done', text: `任务 ${taskId} 已完成：${task.urls[0]}${task.urls.length > 1 ? ` 等 ${task.urls.length} 个产物` : ''}` }
      : { kind: 'failed', text: `任务 ${taskId} 显示成功，但没有返回产物` }
  }
  const code = task.errorCode && task.errorCode !== '0' ? `（${task.errorCode}）` : ''
  if (task.status === 'FAILED' || code) {
    return { kind: 'failed', text: `任务 ${taskId} 失败：${task.errorMessage || '上游没给原因'}${code}` }
  }
  return { kind: 'pending', text: `任务 ${taskId} 仍在${task.status === 'QUEUED' ? '排队' : '运行'}，稍后再查一次` }
}

/** 读这条渠道（或 Key 分组）的 Key；读失败（没存 / 解不开）一律当「没有 Key」，给同一句人话 */
export async function loadEntryKey(
  channels: Pick<ChannelStore, 'loadToken' | 'loadCredentialGroupToken'>,
  channelId: string,
  groupId?: string,
): Promise<string> {
  const apiKey = await (groupId ? channels.loadCredentialGroupToken(channelId, groupId) : channels.loadToken(channelId)).catch(() => null)
  if (!apiKey) throw new Error('这条渠道还没存 API Key —— 先在连接区填好 Key，再测试')
  return apiKey
}
