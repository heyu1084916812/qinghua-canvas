import type { GenerationData } from '../../../../domain/canvas/model/node'
import type { PanelEvent } from '../panelModel'
import { ParamPicker, type ParamOption, type ParamSection } from '../ParamPicker'
import { MANAGE_WORKFLOWS_OPTION, useOpenWorkflowsPage } from './useOpenWorkflowsPage'
import { Icon, Settings } from '../../../../ui/icon'
import { ChannelIcon } from '../../../../features/shared/channelIcon/ChannelIcon'
import { workflowModelId, type WorkflowEntry, type WorkflowParamField } from '../../../../domain/project/workflowParams'
import { workflowSubmitList, workflowValueMap } from './creationWorkflowMode'
import { findWorkflowSourceRow, workflowSourceRows, type WorkflowPanelSources, type WorkflowSourceRow } from './workflowPanelSources'
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
  /**
   * 从条目下拉**换回 API 模型**走面板自己的 `selectModel`（按逻辑模型重新选路 + 配方快照，#1128 M11）；
   * 不传时退回只换模型 id（单测用）。
   */
  onSelectApiModel?: (model: string) => void
  openPicker: string | null
  onTogglePicker: (key: string) => void
  onClosePicker: () => void
  onEvent: (event: PanelEvent) => void
  disabled?: boolean
}

/** 条目 → 节点上存的模型 id（AI 应用是 `app:` 前缀，工作是 `workflow:`） */
export function workflowEntryModelId(entry: WorkflowEntry): string {
  return entry.kind === 'app' ? `app:${entry.id}` : workflowModelId(entry.id)
}

function isMediaField(field: WorkflowParamField): boolean {
  return field.type === 'image' || field.type === 'video' || field.type === 'audio'
}

/** 候选很多的下拉（采样器 20+ 项）只露几行、段内滚动，别把浮层撑满屏（#1128） */
const LONG_LIST = 6
const LONG_LIST_ROWS = 5
/** 参数浮层最高占视口的这一比例（实测 1440×900 上原来几乎顶满） */
const PARAMS_CAP = 0.62

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

/**
 * 条目下拉选中一项 → 要发的事件（导出供单测）。
 *
 * 应用与工作流同一口径（#1128 M2：上一版固定拼 `workflow:`，应用永远匹配不上；
 * 匹配上也会被当工作流提交）。换了条目就换成它自己的默认值：旧条目填过的值不该跟着串门。
 */
export function entrySelectionEvents(
  rows: readonly WorkflowSourceRow[],
  value: string,
  instance: 'default' | 'plus',
): PanelEvent[] {
  const row = rows.find((item) => `${item.channelId}::${workflowEntryModelId(item.entry)}` === value)
  if (!row) return []
  return [
    { type: 'setModel', model: workflowEntryModelId(row.entry), channelId: row.channelId },
    { type: 'setWorkflowRun', list: workflowSubmitList(row.entry, {}), instance: row.entry.kind === 'app' ? 'default' : instance },
  ]
}

export function WorkflowParameterControls({
  data,
  sources,
  apiOptions = [],
  onSelectApiModel,
  openPicker,
  onTogglePicker,
  onClosePicker,
  onEvent,
  disabled,
}: WorkflowParameterControlsProps) {
  const rows = workflowSourceRows(sources)
  /** 找不到条目就**明说**（#1128 H3），不拿 `rows[0]` 顶替——那会显示并改写另一个条目 */
  const current = findWorkflowSourceRow(sources, data.model, data.channelId)
  const openWorkflows = useOpenWorkflowsPage()
  const values = workflowValueMap(data)
  const instance = data.workflowInstance === 'plus' ? 'plus' : 'default'
  const channelCount = new Set(rows.map((row) => row.channelId)).size

  const emit = (nextValues: Record<string, string>, nextInstance: 'default' | 'plus' = instance) => {
    if (!current) return
    onEvent({
      type: 'setWorkflowRun',
      list: workflowSubmitList(current.entry, nextValues),
      instance: nextInstance,
    })
  }

  const selectEntry = (value: string) => {
    for (const event of entrySelectionEvents(rows, value, instance)) onEvent(event)
  }

  const exposed = (current?.entry.fields ?? []).filter((field) => field.enabled)
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
        ...(field.options.length > LONG_LIST ? { maxRows: LONG_LIST_ROWS } : {}),
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
    { value: MANAGE_WORKFLOWS_OPTION, label: '管理 AI 应用 / 工作流…', hint: '打开管理页', icon: <Icon icon={Settings} px={18} /> },
  ]

  const isApp = current?.entry.kind === 'app'
  return (
    <>
      <ParamPicker
        name="model"
        ariaLabel="工作流条目"
        triggerIcon={<ChannelIcon protocol={current?.protocol ?? rows[0]?.protocol ?? 'runninghub-api'} size={18} />}
        label={current ? current.entry.title : '条目不存在'}
        options={options}
        value={current ? `${current.channelId}::${workflowEntryModelId(current.entry)}` : ''}
        variant="list"
        open={openPicker === 'model'}
        onToggle={() => onTogglePicker('model')}
        onClose={onClosePicker}
        onSelect={(next: string) => {
          if (next === MANAGE_WORKFLOWS_OPTION) {
            openWorkflows(current ? { channelId: current.channelId, tab: isApp ? 'app' : 'workflow', entryId: current.entry.id } : {})
            return
          }
          /* 不带 `::` 的是普通 API 模型：直接换模型，行会自动回到 API 模式 */
          if (next.includes('::')) selectEntry(next)
          else if (onSelectApiModel) onSelectApiModel(next)
          else onEvent({ type: 'setModel', model: next, channelId: data.channelId })
        }}
        disabled={disabled === true}
      />
      {!current ? (
        <span className={creationStyles.paramHint} data-workflow-missing>
          这个条目已被删除或不在当前渠道，换一个条目再生成
        </span>
      ) : null}
      {/* AI 应用的提交体不吃实例规格：只给工作流显示（#1127 M1） */}
      {current && !isApp ? <span className={creationStyles.paramDivider} data-param-divider aria-hidden="true" /> : null}
      {current && !isApp ? <ParamPicker
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
      /> : null}
      {sections.length > 0 ? (
        <ParamPicker
          name="workflowParams"
          ariaLabel="工作流参数"
          label={label === '' ? `${sections.length} 项参数` : label}
          sections={sections}
          capHeight={PARAMS_CAP}
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
  const rows = workflowSourceRows(sources)
  const openWorkflows = useOpenWorkflowsPage()
  if (rows.length === 0) return null

  const valueOf = (row: WorkflowSourceRow) => `${row.channelId}::${workflowEntryModelId(row.entry)}`

  return (
    <span className={creationStyles.toolGroup} data-workflow-launcher>
      <ParamPicker
        name="workflowEntry"
        ariaLabel="工作流条目"
        label="工作流"
        variant="list"
        options={[
          ...rows.map((row) => ({
            value: valueOf(row),
            label: row.entry.title,
            hint: row.channelName,
            icon: <ChannelIcon protocol={row.protocol} size={18} />,
          })),
          { value: MANAGE_WORKFLOWS_OPTION, label: '管理 AI 应用 / 工作流…', hint: '打开管理页', icon: <Icon icon={Settings} px={18} /> },
        ]}
        value=""
        open={openPicker === 'workflowEntry'}
        onToggle={() => onTogglePicker('workflowEntry')}
        onClose={onClosePicker}
        onSelect={(next: string) => {
          if (next === MANAGE_WORKFLOWS_OPTION) {
            openWorkflows({})
            return
          }
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
