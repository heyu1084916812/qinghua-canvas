import {
  WORKFLOW_MODEL_PREFIX,
  type WorkflowEntry,
  type WorkflowParamField,
} from './workflowParams'

/**
 * 工作流参数的**取值与提交体**（对账 #1104）。
 *
 * 与 `workflowParams.ts` 的分工：那份管「字段表怎么来、怎么存、怎么合并」，
 * 这份管「这一次到底发什么」—— 值从哪取、必填怎么拦、种子怎么归一、`nodeInfoList` 怎么拼。
 * 拆开的原因很实在：两块各有各的判据（解析要对上游 JSON 的怪癖负责，
 * 取值要对"用户清空"和"隐藏项不下发"负责），混在一份里改一边就得重读另一边。
 *
 * 分层：仍然只有纯函数；发请求在 `platform/channels/runninghubWorkflow.ts`。
 */

/** 暴露给节点的那几个字段（顺序即面板顺序） */
/** 媒体字段的「用上游素材」哨兵：面板发它，执行期按顺序取上游素材、上传、换成 `fileName`。 */
export const UPSTREAM_MEDIA_VALUE = '__upstream__'

export function exposedFields(fields: readonly WorkflowParamField[]): WorkflowParamField[] {
  return fields.filter((field) => field.enabled)
}

/**
 * 字段的本次取值：节点上填过就用节点的，没填过用工作流里的现值。
 *
 * **不能用 `?? ''` 把空串当"没填"**：用户可能就是要清空一个可选参数，
 * 而清空后的合法表达是「这个字段不下发」（见 `workflowNodeInfoList`），不是发一个空串。
 */
export function fieldValueOf(
  field: WorkflowParamField,
  values: Readonly<Record<string, unknown>> | undefined,
): string {
  if (values && Object.prototype.hasOwnProperty.call(values, field.id)) {
    const raw = values[field.id]
    if (typeof raw === 'string') return raw
    if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw)
    return ''
  }
  return field.value
}

/**
 * 提交前的必填校验。
 *
 * 只校验**暴露出来**的字段：隐藏字段由工作流自己带默认值，我们连它的值都不知道，
 * 拿它去拦用户等于凭空造错。
 */
export function missingRequiredFields(
  fields: readonly WorkflowParamField[],
  values: Readonly<Record<string, unknown>> | undefined,
): WorkflowParamField[] {
  return exposedFields(fields).filter(
    (field) => field.required && fieldValueOf(field, values).trim() === '',
  )
}

export const WORKFLOW_SEED_MAX = 0xffffffff

/** 种子归一：非数字回落 `0`，负数取绝对值，超 32 位取模（ComfyUI 的 seed 是 uint32） */
export function normalizeWorkflowSeed(value: unknown): string {
  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : ''
  const n = Number(text)
  if (!Number.isFinite(n)) return '0'
  const abs = Math.abs(Math.trunc(n))
  return String(abs > WORKFLOW_SEED_MAX ? abs % (WORKFLOW_SEED_MAX + 1) : abs)
}

/** 给种子字段抽一个新值 */
export function randomWorkflowSeed(random: () => number = Math.random): string {
  const value = Math.floor(random() * (WORKFLOW_SEED_MAX + 1))
  return String(Math.min(Math.max(value, 0), WORKFLOW_SEED_MAX))
}

/**
 * 字段表 + 节点上的值 → `nodeInfoList`（提交体）。
 *
 * 三条口径：
 * 1. **只发暴露且非空的字段** —— 隐藏项不下发，让工作流自己的默认值生效；
 * 2. 媒体字段用调用方给的 `mediaValues`（已上传回来的 `fileName`），覆盖工作流里的旧值；
 * 3. 种子按 32 位归一（`seed: true` 的字段），否则服务端可能静默改种子。
 */
export function workflowNodeInfoList(opts: {
  fields: readonly WorkflowParamField[]
  values?: Readonly<Record<string, unknown>>
  /** 媒体字段 → 已上传的 `fileName`（键 = 字段 id） */
  mediaValues?: Readonly<Record<string, string>>
}): { nodeId: string; fieldName: string; fieldValue: string }[] {
  const out: { nodeId: string; fieldName: string; fieldValue: string }[] = []
  for (const field of exposedFields(opts.fields)) {
    const media = opts.mediaValues?.[field.id]
    const raw = media !== undefined ? media : fieldValueOf(field, opts.values)
    const value = field.seed ? normalizeWorkflowSeed(raw) : raw
    if (value === '') continue
    out.push({ nodeId: field.nodeId, fieldName: field.fieldName, fieldValue: value })
  }
  return out
}

/**
 * 工作流条目的类别（生成节点按"出图 / 出视频"分组用）。
 *
 * 判据只有一条：暴露出来的媒体字段里**有没有视频**。没有可见信息时按图片 ——
 * 猜错的代价只是下拉分组，不影响能否运行。
 */
export function workflowEntryCategory(entry: WorkflowEntry): 'image' | 'video' {
  return exposedFields(entry.fields).some((field) => field.type === 'video') ? 'video' : 'image'
}

/**
 * 条目 id → 模型 id（`workflow:<id>`）。
 *
 * 刻意放在这份「取值」模块里也导出一次：执行期只拿得到 `request.model`，
 * 那时不想为了拆一个前缀再去引「字段表」那一整个模块。
 */
export function workflowModelIdOfEntry(entryId: string): string {
  return `${WORKFLOW_MODEL_PREFIX}${entryId}`
}
