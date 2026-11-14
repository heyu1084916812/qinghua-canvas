import type { GenerationData } from '../../../../domain/canvas/model/node'
import type { WorkflowEntry } from '../../../../domain/project/workflowParams'
import { UPSTREAM_MEDIA_VALUE } from '../../../../domain/project/workflowParamValues'

/**
 * 创作面板「API / AI 应用 / 工作流」的判定与提交体拼装（对账 #1105）。
 *
 * 纯函数：模式由模型 id 反推（不新增节点字段）；提交体只发暴露字段；
 * 媒体字段在面板上没有值 → 下发 `UPSTREAM_MEDIA_VALUE` 哨兵，由执行期换成上传后的文件名。
 */

export type CreationSourceMode = 'api' | 'app' | 'flow'

export function modeOfModel(model: string): CreationSourceMode {
  if (model.startsWith('workflow:')) return 'flow'
  if (model.startsWith('app:')) return 'app'
  return 'api'
}

/** 节点上存着的提交体 → `字段 id → 值`（字段 id = `<nodeId>::<fieldName>`） */
export function workflowValueMap(data: GenerationData): Record<string, string> {
  const map: Record<string, string> = {}
  for (const item of data.workflowNodeInfoList ?? []) {
    map[`${item.nodeId}::${item.fieldName}`] = item.fieldValue
  }
  return map
}

function isMediaField(entry: WorkflowEntry, fieldId: string): boolean {
  const field = entry.fields.find((item) => item.id === fieldId)
  return field ? field.type === 'image' || field.type === 'video' || field.type === 'audio' : false
}

/**
 * 「暴露字段 + 当前值」→ `nodeInfoList`。
 *
 * 媒体字段：面板填了值就用它（一般是上次上传回来的文件名），没填就发哨兵
 * `UPSTREAM_MEDIA_VALUE` —— 执行期换成本次上游素材的文件名；上游也没素材时
 * 适配器会**丢掉这一项**，让工作流自己的默认值生效。
 */
export function workflowSubmitList(
  entry: WorkflowEntry,
  values: Record<string, string>,
): { nodeId: string; fieldName: string; fieldValue: string }[] {
  return entry.fields
    .filter((field) => field.enabled)
    .map((field) => {
      const raw = values[field.id]
      if (raw !== undefined) return { nodeId: field.nodeId, fieldName: field.fieldName, fieldValue: raw }
      return {
        nodeId: field.nodeId,
        fieldName: field.fieldName,
        fieldValue: isMediaField(entry, field.id) ? UPSTREAM_MEDIA_VALUE : field.value,
      }
    })
}
