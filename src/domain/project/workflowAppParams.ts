import {
  inferWorkflowParamType,
  isSeedFieldName,
  type WorkflowParamField,
  type WorkflowParamType,
} from './workflowParams'

/**
 * **AI 应用**的参数表（对账 #1107）。
 *
 * 数据来自 `GET /api/webapp/apiCallDemo` 的 `data.nodeInfoList`（2026-11-14 真机核对，
 * 下列字段全都实测过）。与「自建工作流」那条路的关键差别，别把两套默认值混用：
 *
 * | | 自建工作流（`getJsonApiFormat`） | AI 应用（`apiCallDemo`） |
 * | --- | --- | --- |
 * | 回来的范围 | **全部**节点输入（作者没打算外露的内部参数也在里面） | **只有作者勾选开放的**那几个 |
 * | 默认暴露 | **全隐藏**（要用户自己勾） | **全暴露**（本来就是开放给调用者的） |
 * | 中文名 | 没有（只有节点标题） | `description` / `descriptionEn` |
 * | 候选值 | **拿不到**（只能人工配） | `fieldData` 里带 `name/index/description` |
 *
 * 官方返回体形状：`{nodeId, nodeName, fieldName, fieldValue, fieldType, description,
 * descriptionEn, fieldData}`，其中 `fieldData` 是**字符串化 JSON**，三种形状各有用途：
 * - `'["STRING", {"default":"", "multiline": true}]'` ⇒ 多行 / 单行文本；
 * - `'[{"name","index","description"}, …]'` ⇒ 下拉候选；末尾常有一条
 *   `{"default": …, "description":"忽略"}` 的**哨兵项**，要跳过；
 * - `'[[…示例文件名…], {"image_upload": true}]'` ⇒ 媒体槽（吃上传回来的 `fileName`）。
 */

function asText(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

interface ParsedFieldData {
  options: string[]
  multiline: boolean
}

/** `fieldData` → 候选值 / 是否多行。解析失败一律回空：宁可不给下拉，也不给假选项。 */
export function parseAppFieldData(fieldData: string): ParsedFieldData {
  const empty: ParsedFieldData = { options: [], multiline: false }
  const text = (fieldData ?? '').trim()
  if (!text || (text[0] !== '[' && text[0] !== '{')) return empty
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return empty
  }
  if (!Array.isArray(data)) return empty
  /** `["STRING", {"multiline": true}]` 这种"类型 + 选项"两段式 */
  const meta = data[1]
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
    if ((meta as Record<string, unknown>).multiline === true) return { options: [], multiline: true }
  }
  /** 候选列表：只认带 `name` 的项（`{"default":…,"description":"忽略"}` 是哨兵） */
  const options: string[] = []
  for (const item of data) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const name = asText((item as Record<string, unknown>).name).trim()
    if (!name || options.includes(name)) continue
    options.push(name)
  }
  return { options, multiline: false }
}

function appFieldType(
  fieldType: string,
  fieldData: string,
  fieldName: string,
  value: string,
): WorkflowParamType {
  if (fieldType === 'IMAGE') return 'image'
  if (fieldType === 'VIDEO') return 'video'
  if (fieldType === 'AUDIO') return 'audio'
  if (fieldType === 'BOOLEAN') return 'boolean'
  if (fieldType === 'NUMBER' || fieldType === 'INT' || fieldType === 'FLOAT') return 'number'
  if (fieldType === 'LIST' || fieldType === 'DROPDOWN') {
    /** 候选解析不出来的 LIST 只当文本：给一个空下拉等于让用户无值可选 */
    return parseAppFieldData(fieldData).options.length > 0 ? 'select' : 'text'
  }
  if (fieldType === 'STRING') {
    return parseAppFieldData(fieldData).multiline ? 'textarea' : 'text'
  }
  /** 没声明类型：按值 / 名字推（与工作流同一条启发式） */
  return inferWorkflowParamType(fieldName, value)
}

/** `apiCallDemo` 的 `nodeInfoList` → 字段表（**默认全部暴露**，见文件头对照表） */
export function parseAppNodeInfoList(items: unknown): WorkflowParamField[] {
  if (!Array.isArray(items)) return []
  const out: WorkflowParamField[] = []
  const seen = new Set<string>()
  const mediaCount = new Map<string, number>()
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue
    const record = raw as Record<string, unknown>
    const nodeId = asText(record.nodeId).trim()
    const fieldName = asText(record.fieldName).trim()
    if (!nodeId || !fieldName) continue
    const id = `${nodeId}::${fieldName}`
    if (seen.has(id)) continue
    seen.add(id)
    const fieldType = asText(record.fieldType).toUpperCase()
    const fieldData = asText(record.fieldData)
    const value = asText(record.fieldValue)
    const type = appFieldType(fieldType, fieldData, fieldName, value)
    const media = type === 'image' || type === 'video' || type === 'audio'
    const order = media ? (mediaCount.get(type) ?? 0) : 0
    if (media) mediaCount.set(type, order + 1)
    out.push({
      id,
      nodeId,
      fieldName,
      type,
      /** 中文名优先（作者写的「上传图像」「输出比例」比 `image` / `aspect_ratio` 有用） */
      label: asText(record.description).trim() || asText(record.descriptionEn).trim() || fieldName,
      value,
      enabled: true,
      group: asText(record.nodeName).trim() || nodeId,
      options: parseAppFieldData(fieldData).options,
      min: null,
      max: null,
      step: type === 'number' ? 1 : null,
      seed: isSeedFieldName(fieldName),
      /** 应用没有声明必填，不猜；媒体槽仍按"必须给图"处理（不给图跑不出东西） */
      required: media,
      mediaOrder: order,
    })
  }
  return out
}
