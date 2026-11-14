import type { GenerationData } from '../../../../domain/canvas/model/node'
import type { WorkflowEntry } from '../../../../domain/project/workflowParams'

/**
 * 创作面板「API / AI 应用 / 工作流」的判定与提交体拼装（对账 #1105）。
 *
 * 抽成纯函数的理由：面板里那段逻辑要能被单测钉住（尤其"只发已暴露字段"与
 * "值没填就回落字段默认值"这两条），而组件本身只能跑服务端渲染冒烟。
 */

export type CreationSourceMode = 'api' | 'app' | 'flow'

/** 模式**由模型 id 反推**：`workflow:` / `app:` / 其余 = API（不新增节点字段） */
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

/**
 * 「暴露字段 + 当前值」→ `nodeInfoList`。
 *
 * 三条口径：只发 `enabled`；值优先取面板草稿，没填回落字段默认值；空串照发
 * （空串在 RunningHub 是"清空这个参数"，不是"没填"——与 `workflowNodeInfoList` 一致）。
 */
export function workflowSubmitList(
  entry: WorkflowEntry,
  values: Record<string, string>,
): { nodeId: string; fieldName: string; fieldValue: string }[] {
  return entry.fields
    .filter((field) => field.enabled)
    .map((field) => ({
      nodeId: field.nodeId,
      fieldName: field.fieldName,
      fieldValue: values[field.id] ?? field.value,
    }))
}
