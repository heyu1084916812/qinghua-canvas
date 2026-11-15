import { ChannelError } from './types'
import { workflowRunList, type WorkflowRunItem } from '../../domain/project/workflowRunList'
import { normalizeWorkflowEntries, workflowEntriesRowId } from '../../domain/project/workflowParams'
import { workflowNodeListOf } from './runninghubWorkflowRun'

/**
 * 执行期按**最新条目**重拼提交体（#1127 M9 / H3）。
 *
 * - 有 `storage`：读 `workflow:entries:<channelId>`，找不到这个条目（被删了 / 属于另一条渠道）
 *   就**拦下不提交**——上一版会拿面板兜底的另一个条目的 nodeId 去跑，花钱跑错东西；
 *   必填项为空也在这里拦（服务端只会回一句看不懂的 1007）。
 * - 没有 `storage`、或这条渠道从没存过条目行：按节点存的三元组原样发。
 */
export async function latestRunList(
  storage: { query(table: 'presets', filter: { id: string }): Promise<unknown[]> } | undefined,
  input: { channelId: string; kind: 'workflow' | 'app'; entryId: string; raw: unknown; prompt: string },
): Promise<WorkflowRunItem[]> {
  const nodeList = workflowNodeListOf(input.raw)
  if (!storage) return nodeList
  const rows = await storage.query('presets', { id: workflowEntriesRowId(input.channelId) }).catch(() => null)
  /** 读不到 / 这条渠道从没存过条目行（老数据、旁路）：按节点存的原样发，不凭空拦 */
  if (rows === null || rows.length === 0) return nodeList
  const entries = normalizeWorkflowEntries((rows[0] as { entries?: unknown } | undefined)?.entries)
  const entry = entries.find((item) => item.id === input.entryId && (item.kind ?? 'workflow') === input.kind)
  const label = input.kind === 'app' ? 'AI 应用' : '工作流'
  if (!entry) {
    throw new ChannelError({
      kind: 'validation',
      field: `${label}条目`,
      reason: `这条渠道里没有${label} ${input.entryId}（可能已删除或属于另一条渠道），去「AI 应用和工作流」页重新导入，或在节点上换一个条目`,
    })
  }
  const { list, missing } = workflowRunList(entry, nodeList, input.prompt)
  if (missing.length > 0) {
    throw new ChannelError({
      kind: 'validation',
      field: entry.title,
      reason: `必填参数没填：${missing.map((field) => field.label || field.fieldName).join('、')}`,
    })
  }
  return list
}

