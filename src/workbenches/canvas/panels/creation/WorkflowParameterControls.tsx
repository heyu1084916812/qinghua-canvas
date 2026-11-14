import type { GenerationData } from '../../../../domain/canvas/model/node'
import type { PanelEvent } from '../panelModel'
import { ParamPicker, type ParamOption, type ParamSection } from '../ParamPicker'
import { ChannelIcon } from '../../../../features/shared/channelIcon/ChannelIcon'
import {
  entryIdOfModel,
  workflowModelId,
  type WorkflowEntry,
  type WorkflowParamField,
} from '../../../../domain/project/workflowParams'
import { workflowSubmitList, workflowValueMap } from './creationWorkflowMode'
import { workflowChannelsOf, type WorkflowPanelSources } from './workflowPanelSources'
import { creationStyles } from './creationStyles'

/**
 * 创作面板「工作流模式」的参数行（对账 #1105）。
 *
 * **与 API 模式同一行、同一套控件**（用户 2026-11-14：
 * 「我的代码都已经有发送和生成的按钮，为什么还有运行」/「没有真正的融合」）：
 *
 * ```
 * 语言  [icon] 视频超分与补帧 │ 24G │ 源视频 · 0.8 · 16:9        ↑
 * ```
 *
 * - **不另起「运行」按钮**：生成还是原来那一枚（`CreationRunActionsView`）。
 * - **不单独摆「渠道」**：条目所属渠道由 chip 前面的品牌图标表达，点开后在
 *   列表里用副标题标出（与「模型」那枚同一种做法 —— 渠道本来就是模型的属性）。
 * - **只出现工作流自己的字段**：API 那套比例 / 清晰度 / 张数在这里一个都不留。
 * - **不写花钱小字**：费用说明留在设置页与市场卡片，面板底部只放能点得动的东西。
 *
 * 媒体字段（图 / 视频 / 音频）不在行上单列 —— 它们由**上游连线或素材条**提供，
 * 与 API 模式「参考图」走同一条路；提交时下发 `__upstream__` 哨兵。
 */
export type WorkflowParameterControlsProps = {
  data: GenerationData
  sources: WorkflowPanelSources
  /**
   * API 模型的那几个选项：条目的下拉里要能**换回普通模型**，
   * 否则一旦进了工作流模式就没有出口了。用 `hint` 标成「API 模型」。
   */
  apiOptions?: ParamOption[]
  openPicker: string | null
  onTogglePicker: (key: string) => void
  onClosePicker: () => void
  onEvent: (event: PanelEvent) => void
  disabled?: boolean
}

/** 一条可选来源：哪个渠道下的哪个条目（面板不认「RunningHub」这件事，只认这份清单） */
interface WorkflowSourceRow {
  channelId: string
  channelName: string
  protocol: string
  entry: WorkflowEntry
}

function sourceRows(sources: WorkflowPanelSources): WorkflowSourceRow[] {
  return workflowChannelsOf(sources).flatMap((channel) =>
    channel.entries.map((entry) => ({
      channelId: channel.id,
      channelName: channel.name,
      protocol: channel.protocol,
      entry,
    })),
  )
}

/** 条目 → 节点上存的模型 id（AI 应用是 `app:` 前缀，工作是 `workflow:`） */
export function workflowEntryModelId(entry: WorkflowEntry): string {
  return entry.kind === 'app' ? `app:${entry.id}` : workflowModelId(entry.id)
}

function isMediaField(field: WorkflowParamField): boolean {
  return field.type === 'image' || field.type === 'video' || field.type === 'audio'
}

/**
 * chip 上那行摘要：「源视频 · 0.8 · 16:9」。
 *
 * 与 API 模式「4K · 高 · 默认 · 16:9」同一句话的意思 —— **当前会发出去的值**，
 * 而不是「有 2 个参数」这种还要点开才知道的计数。媒体字段写不出值（它来自上游），
 * 就写它自己的名字，让人一眼知道这个工作流要喂什么。
 */
export function workflowSummaryLabel(
  fields: WorkflowParamField[],
  values: Record<string, string>,
): string {
  const parts: string[] = []
  for (const field of fields) {
    if (!field.enabled) continue
    if (isMediaField(field)) {
      parts.push(field.label || field.fieldName)
      continue
    }
    const raw = values[field.id] ?? field.value
    const text = field.type === 'boolean' ? (String(raw).toLowerCase() === 'true' ? '开' : '关') : String(raw ?? '').trim()
    if (text !== '') parts.push(text)
    if (parts.length >= 4) break
  }
  return parts.join(' · ')
}

export function WorkflowParameterControls({
  data,
  sources,
  apiOptions = [],
  openPicker,
  onTogglePicker,
  onClosePicker,
  onEvent,
  disabled,
}: WorkflowParameterControlsProps) {
  const rows = sourceRows(sources)
  if (rows.length === 0) return null

  const entryId = entryIdOfModel(data.model ?? '')
  const current =
    rows.find((row) => row.channelId === data.channelId && row.entry.id === entryId) ??
    rows.find((row) => row.entry.id === entryId) ??
    rows[0]!
  const values = workflowValueMap(data)
  const instance = data.workflowInstance === 'plus' ? 'plus' : 'default'
  const channelCount = new Set(rows.map((row) => row.channelId)).size

  const emit = (nextValues: Record<string, string>, nextInstance: 'default' | 'plus' = instance) => {
    onEvent({
      type: 'setWorkflowRun',
      list: workflowSubmitList(current.entry, nextValues),
      instance: nextInstance,
    })
  }

  const selectEntry = (value: string) => {
    const row = rows.find((item) => `${item.channelId}::${workflowModelId(item.entry.id)}` === value)
    if (!row) return
    onEvent({ type: 'setModel', model: workflowModelId(row.entry.id), channelId: row.channelId })
    /** 换了条目就换成它自己的默认值：旧条目填过的值不该跟着串门 */
    onEvent({
      type: 'setWorkflowRun',
      list: workflowSubmitList(row.entry, {}),
      instance,
    })
  }

  const exposed = current.entry.fields.filter((field) => field.enabled)
  const editable = exposed.filter((field) => !isMediaField(field))
  const label = workflowSummaryLabel(exposed, values)

  const sections: ParamSection[] = editable.map((field) => {
    const value = values[field.id] ?? field.value
    const name = field.id
    const title = field.label || field.fieldName
    const select = (next: string) => emit({ ...values, [name]: next })
    if (field.type === 'select') {
      return {
        name,
        label: title,
        variant: 'list',
        options: field.options.map((option) => ({ value: option, label: option })),
        value,
        onSelect: select,
      }
    }
    if (field.type === 'boolean') {
      return {
        name,
        label: title,
        variant: 'list',
        options: [
          { value: 'true', label: '开' },
          { value: 'false', label: '关' },
        ],
        value: String(value).toLowerCase() === 'true' ? 'true' : 'false',
        onSelect: select,
      }
    }
    if (field.type === 'number' && field.min !== null && field.max !== null) {
      return {
        name,
        label: title,
        variant: 'slider',
        options: [],
        value,
        min: field.min,
        max: field.max,
        step: field.step ?? 1,
        onSelect: select,
      }
    }
    return {
      name,
      label: title,
      variant: 'text',
      options: [],
      value,
      placeholder: field.type === 'number' ? '数字' : '填写值',
      onSelect: select,
    }
  })

  const options: ParamOption[] = [
    ...rows.map((row) => ({
      value: `${row.channelId}::${workflowEntryModelId(row.entry)}`,
      label: row.entry.title,
      /** 一条渠道时写「工作流」；多一条才需要分清是哪本站的 */
      hint: row.entry.kind === 'app' ? 'AI 应用' : channelCount > 1 ? row.channelName : '工作流',
      icon: <ChannelIcon protocol={row.protocol} size={18} />,
    })),
    ...apiOptions.map((option) => ({ ...option, hint: 'API 模型' })),
  ]

  return (
    <>
      <ParamPicker
        name="model"
        ariaLabel="工作流条目"
        triggerIcon={<ChannelIcon protocol={current.protocol} size={18} />}
        label={current.entry.title}
        options={options}
        value={`${current.channelId}::${workflowEntryModelId(current.entry)}`}
        variant="list"
        open={openPicker === 'model'}
        onToggle={() => onTogglePicker('model')}
        onClose={onClosePicker}
        onSelect={(next: string) => {
          /* 不带 `::` 的是普通 API 模型：直接换模型，行会自动回到 API 模式 */
          if (!next.includes('::')) onEvent({ type: 'setModel', model: next, channelId: data.channelId })
          else selectEntry(next)
        }}
        disabled={disabled === true}
      />
      <span className={creationStyles.paramDivider} data-param-divider aria-hidden="true" />
      <ParamPicker
        name="workflowInstance"
        ariaLabel="实例规格"
        label={instance === 'plus' ? '48G' : '24G'}
        options={[
          { value: 'default', label: '24G' },
          { value: 'plus', label: '48G' },
        ]}
        value={instance}
        variant="list"
        open={openPicker === 'workflowInstance'}
        onToggle={() => onTogglePicker('workflowInstance')}
        onClose={onClosePicker}
        onSelect={(next: string) => emit(values, next === 'plus' ? 'plus' : 'default')}
        disabled={disabled === true}
      />
      {sections.length > 0 ? (
        <ParamPicker
          name="workflowParams"
          ariaLabel="工作流参数"
          label={label === '' ? `${sections.length} 项参数` : label}
          sections={sections}
          open={openPicker === 'workflowParams'}
          onToggle={() => onTogglePicker('workflowParams')}
          onClose={onClosePicker}
          disabled={disabled === true}
        />
      ) : null}
    </>
  )
}

export type WorkflowEntryLauncherProps = {
  /** `null` = 这次不显示（提示词面板 / 已在工作流模式） */
  sources: WorkflowPanelSources | null | undefined
  openPicker: string | null
  onTogglePicker: (key: string) => void
  onClosePicker: () => void
  onEvent: (event: PanelEvent) => void
  disabled?: boolean
}

/**
 * API 模式下的「工作流」入口：**参数行末尾、生成按钮左边的一枚 chip**。
 *
 * 为什么需要它：模型下拉只列「用户拍板的展示名」，而条目的模型 id 是
 * `workflow:<id>` —— 它不会出现在那份清单里。没有这枚 chip，用户根本没有
 * 办法在面板里挑一个工作流（用户 2026-11-14：「我选择工作流的时候应该就
 * 按照我工作流的来」）。
 *
 * 选中后：模型位换成该条目，参数行随即整行换成工作流的暴露字段，
 * 生成按钮还是原来那一枚。
 */
export function WorkflowEntryLauncher({
  sources,
  openPicker,
  onTogglePicker,
  onClosePicker,
  onEvent,
  disabled,
}: WorkflowEntryLauncherProps) {
  /** 工作流与 AI 应用**同一条链路**：执行端都收 `nodeInfoList`（应用走 `app:` 前缀） */
  const rows = sources ? sourceRows(sources) : []
  if (rows.length === 0) return null

  const valueOf = (row: WorkflowSourceRow) => `${row.channelId}::${workflowEntryModelId(row.entry)}`

  return (
    <span className={creationStyles.toolGroup} data-workflow-launcher>
      <ParamPicker
        name="workflowEntry"
        ariaLabel="工作流条目"
        label="工作流"
        variant="list"
        options={rows.map((row) => ({
          value: valueOf(row),
          label: row.entry.title,
          hint: row.channelName,
          icon: <ChannelIcon protocol={row.protocol} size={18} />,
        }))}
        value=""
        open={openPicker === 'workflowEntry'}
        onToggle={() => onTogglePicker('workflowEntry')}
        onClose={onClosePicker}
        onSelect={(next: string) => {
          const row = rows.find((item) => valueOf(item) === next)
          if (!row) return
          onEvent({ type: 'setModel', model: workflowEntryModelId(row.entry), channelId: row.channelId })
          /* 换条目就换成它自己的默认值，旧条目的值不跟着串门（与条目下拉同一口径） */
          onEvent({ type: 'setWorkflowRun', list: workflowSubmitList(row.entry, {}) })
        }}
        disabled={disabled === true}
      />
    </span>
  )
}
