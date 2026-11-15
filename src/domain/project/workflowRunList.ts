import { exposedFields, fieldValueOf, normalizeWorkflowSeed, UPSTREAM_MEDIA_VALUE } from './workflowParamValues'
import type { WorkflowEntry, WorkflowParamField } from './workflowParams'

/** 执行期提交项：多带字段类型与图序，执行端据此按类型分配上游素材（#1127 M3） */
export interface WorkflowRunItem {
  nodeId: string
  fieldName: string
  fieldValue: string
  type?: WorkflowParamField['type']
  mediaOrder?: number
}

const PROMPT_FIELD = /^(prompt|text|positive|positive_prompt|text_positive|prompt_text)$/i

/**
 * 执行期用**最新的条目字段表**重拼提交体（#1127 M9）。
 *
 * 节点上存的 `nodeInfoList` 只当「这个节点填过的值」读：暴露状态、默认值、类型都以条目为准——
 * 设置页取消暴露的字段不再下发，新暴露的字段带默认值下发，不用等用户回节点再改一次。
 *
 * - 媒体字段：节点给了真实文件名就用，否则发 `UPSTREAM_MEDIA_VALUE` 哨兵（执行端换成上传后的文件名）；
 * - 非媒体空值**不下发**（空串在 RunningHub 是「清空该参数」）；必填却为空 → 进 `missing`，调用方拦在提交前；
 * - 种子按 ComfyUI uint64 归一；
 * - `prompt`：面板主提示词框非空时，填进第一个暴露的提示词类字段（`prompt` / `text` / `positive`…）——
 *   不然用户在大框里写的字，工作流一个字都收不到（实机 2026-11-15）。
 */
export function workflowRunList(
  entry: WorkflowEntry,
  nodeList: readonly { nodeId: string; fieldName: string; fieldValue: string }[],
  prompt = '',
): { list: WorkflowRunItem[]; missing: WorkflowParamField[] } {
  const values: Record<string, string> = {}
  for (const item of nodeList) values[`${item.nodeId}::${item.fieldName}`] = item.fieldValue
  const exposed = exposedFields(entry.fields)
  const promptTarget = prompt.trim()
    ? exposed.find((field) => (field.type === 'text' || field.type === 'textarea') && PROMPT_FIELD.test(field.fieldName))
    : undefined
  const list: WorkflowRunItem[] = []
  const missing: WorkflowParamField[] = []
  for (const field of exposed) {
    const media = field.type === 'image' || field.type === 'video' || field.type === 'audio'
    let value = field === promptTarget ? prompt.trim() : fieldValueOf(field, values)
    if (media) {
      if (!value.trim() || value === UPSTREAM_MEDIA_VALUE || field.value === value) value = UPSTREAM_MEDIA_VALUE
      list.push({ nodeId: field.nodeId, fieldName: field.fieldName, fieldValue: value, type: field.type, mediaOrder: field.mediaOrder })
      continue
    }
    if (field.seed) value = normalizeWorkflowSeed(value)
    if (value.trim() === '') {
      if (field.required) missing.push(field)
      continue
    }
    list.push({ nodeId: field.nodeId, fieldName: field.fieldName, fieldValue: value, type: field.type })
  }
  return { list, missing }
}
