import type { WorkflowParamField, WorkflowParamType } from './workflowParams'

/**
 * 工作流参数的**类型标签与常见候选值**（复刻自 `1685901916/canvas-xiong` 的
 * `RH_EDITOR_KNOWN_FIELD_OPTIONS` / `rhKnownOptionsForField`，对账 #1106）。
 *
 * 为什么需要它：`getJsonApiFormat` 回的是**值**，不是节点定义 ——
 * `sampler_name: "euler"` 只告诉我们"它现在等于 euler"，不知道有哪几种可选。
 * 参考项目用一张**按字段名**的字典兜底，让"采样器 / 调度器 / 比例 / 分辨率"
 * 这些最常见的字段一拉回来就是下拉，不用用户手抄候选。
 *
 * 判据是**字段名相等**（大小写不敏感），不做模糊匹配：猜错候选比没有候选更坏
 * （用户会以为工作流只支持这几个值）。
 */
export const KNOWN_FIELD_OPTIONS: Record<string, readonly string[]> = {
  sampler_name: [
    'euler', 'euler_ancestral', 'heun', 'dpm_2', 'dpm_2_ancestral',
    'lms', 'dpmpp_2m', 'dpmpp_sde', 'ddim', 'uni_pc',
  ],
  sampler: [
    'euler', 'euler_ancestral', 'heun', 'dpm_2', 'dpm_2_ancestral',
    'lms', 'dpmpp_2m', 'dpmpp_sde', 'ddim', 'uni_pc',
  ],
  scheduler: ['normal', 'karras', 'exponential', 'sgm_uniform', 'simple', 'ddim_uniform', 'beta'],
  ratio: ['1:1', '16:9', '9:16', '21:9', '9:21', '4:3', '3:4', '4:5', '5:4', '3:2', '2:3'],
  aspectratio: ['1:1', '16:9', '9:16', '4:3', '3:4', '4:5', '5:4', '3:2', '2:3'],
  resolution: ['512', '768', '1024', '1280', '1536', '2048', '1k', '2k', '4k'],
  size: ['512', '768', '1024', '1280', '1536', '2048'],
  steps: ['1', '4', '8', '12', '20', '28', '30', '40', '50'],
  cfg: ['1', '2', '3.5', '5', '7', '8', '12'],
}

/** 字段名 → 候选值；没有就返回空数组（不糊弄） */
export function knownOptionsForField(fieldName: string): string[] {
  const name = String(fieldName ?? '').trim().toLowerCase()
  if (!name) return []
  return [...(KNOWN_FIELD_OPTIONS[name] ?? [])]
}

const TYPE_LABELS: Record<WorkflowParamType, string> = {
  text: '文本',
  textarea: '多行文本',
  number: '数字',
  boolean: '开关',
  select: '下拉',
  image: '图片',
  video: '视频',
  audio: '音频',
}

export function workflowFieldTypeLabel(type: WorkflowParamType): string {
  return TYPE_LABELS[type] ?? type
}

/** 参数面板里"能选哪些类型"（与 `WorkflowParamType` 一一对应，顺序 = 面板顺序） */
export const WORKFLOW_FIELD_TYPES: readonly WorkflowParamType[] = [
  'text',
  'textarea',
  'number',
  'boolean',
  'select',
  'image',
  'video',
  'audio',
]

/**
 * 把「没有候选值」的字段补上字典里的常见候选。
 *
 * 只在 `options` 为空时补；**已经有候选的一律不动**（用户/AI 应用给的更权威）。
 * 补完如果字段还是 `text`/`number`，把它改成 `select` —— 有候选就该是下拉。
 */
export function withKnownOptions(fields: readonly WorkflowParamField[]): WorkflowParamField[] {
  return fields.map((field) => {
    if (field.options.length > 0) return field
    const known = knownOptionsForField(field.fieldName)
    if (known.length === 0) return field
    const numeric = field.type === 'number'
    return {
      ...field,
      type: numeric ? 'number' : 'select',
      options: known,
    }
  })
}
