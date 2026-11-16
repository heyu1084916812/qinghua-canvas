import type { ReactNode } from 'react'
import type { GenerationData } from '../../../../domain/canvas/model/node'
import type { PanelEvent } from '../panelModel'
import { ParamPicker, type ParamSection } from '../ParamPicker'
import type { WorkflowParamField } from '../../../../domain/project/workflowParams'
import { workflowSubmitList, workflowValueMap } from './creationWorkflowMode'
import { findWorkflowSourceRow, type WorkflowPanelSources } from './workflowPanelSources'
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
 * - **条目 chip 就是模型菜单**（#1133）：由面板传进来的 `modelPicker`（「API · 工作流 · CLI」
 *   标签菜单）担任，换条目 / 换回 API / 换 CLI 都在那一个菜单里，这里不再另画条目下拉。
 * - **只出现工作流自己的字段**：API 那套比例 / 清晰度 / 张数在这里一个都不留。
 * - **不写花钱小字**：费用说明留在设置页与市场卡片，面板底部只放能点得动的东西。
 *
 * 媒体字段（图 / 视频 / 音频）不在行上单列 —— 它们由**上游连线或素材条**提供，
 * 与 API 模式「参考图」走同一条路；提交时下发 `__upstream__` 哨兵。
 */
export type WorkflowParameterControlsProps = {
  data: GenerationData
  sources: WorkflowPanelSources
  /** 模型菜单（`SourceModelMenu`，#1133）：放在参数行最前面 */
  modelPicker: ReactNode
  openPicker: string | null
  onTogglePicker: (key: string) => void
  onClosePicker: () => void
  onEvent: (event: PanelEvent) => void
  disabled?: boolean
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

const MISSING_HINT = '这个条目已被删除或不在当前渠道，换一个条目再生成'

export function WorkflowParameterControls({
  data,
  sources,
  modelPicker,
  openPicker,
  onTogglePicker,
  onClosePicker,
  onEvent,
  disabled,
}: WorkflowParameterControlsProps) {
  /** 找不到条目就**明说**（#1128 H3），不拿 `rows[0]` 顶替——那会显示并改写另一个条目 */
  const current = findWorkflowSourceRow(sources, data.model, data.channelId)
  const values = workflowValueMap(data)
  const instance = data.workflowInstance === 'plus' ? 'plus' : 'default'

  const emit = (nextValues: Record<string, string>, nextInstance: 'default' | 'plus' = instance) => {
    if (!current) return
    onEvent({
      type: 'setWorkflowRun',
      list: workflowSubmitList(current.entry, nextValues),
      instance: nextInstance,
    })
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

  const isApp = current?.entry.kind === 'app'
  return (
    <>
      {modelPicker}
      {!current ? (
        <span className={creationStyles.paramHint} data-workflow-missing title={MISSING_HINT}>
          {MISSING_HINT}
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
