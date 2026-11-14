import type { GenerationData } from '../../../../domain/canvas/model/node'
import type { PanelEvent } from '../panelModel'
import { ParamPicker, type ParamSection } from '../ParamPicker'
import { workflowEntryIdOf, workflowModelId, type WorkflowParamField } from '../../../../domain/project/workflowParams'
import { workflowSubmitList, workflowValueMap } from './creationWorkflowMode'
import { workflowChannelsOf, type WorkflowPanelSources } from './workflowPanelSources'
import styles from './WorkflowParameterControls.module.css'

/**
 * 创作面板的「工作流模式」参数区（对账 #1105 / #1106）。
 *
 * 与 API 模式**共用同一条底部行**：渠道 / 条目（= 模型位）/ 实例 / 参数 / 生成按钮，
 * 只是把「视频模式 / 比例 / 清晰度 / 时长 / 张数」换成本工作流暴露出来的字段。
 *
 * 交互沿用面板既有控件（`ParamPicker` 的 chip + 浮层：点开、点外关闭、
 * 同一时刻只开一个、悬停/描边都是同一套样式），不新造下拉。
 */
export type WorkflowParameterControlsProps = {
  data: GenerationData
  sources: WorkflowPanelSources
  openPicker: string | null
  onTogglePicker: (key: string) => void
  onClosePicker: () => void
  onEvent: (event: PanelEvent) => void
  disabled?: boolean
}

export function WorkflowParameterControls({
  data,
  sources,
  openPicker,
  onTogglePicker,
  onClosePicker,
  onEvent,
  disabled,
}: WorkflowParameterControlsProps) {
  const channels = workflowChannelsOf(sources)
  if (channels.length === 0) return null
  const channel = channels.find((item) => item.id === data.channelId) ?? channels[0]
  const entries = channel.entries
  const entry = entries.find((item) => item.id === workflowEntryIdOf(data.model)) ?? entries[0]
  const values = workflowValueMap(data)
  const instance = data.workflowInstance === 'plus' ? 'plus' : 'default'

  const emit = (nextValues: Record<string, string>, nextInstance: 'default' | 'plus' = instance) => {
    if (!entry) return
    onEvent({
      type: 'setWorkflowRun',
      list: workflowSubmitList(entry, nextValues),
      instance: nextInstance,
    })
  }

  const exposed = entry?.fields.filter((field) => field.enabled) ?? []
  const media = exposed.filter((field) => field.type === 'image' || field.type === 'video' || field.type === 'audio')
  const plain = exposed.filter((field) => !media.includes(field))

  const sections: ParamSection[] = plain.map((field) => {
    const value = values[field.id] ?? field.value
    if (field.type === 'select') {
      return {
        name: field.id,
        label: field.label || field.fieldName,
        variant: 'list',
        options: field.options.map((option) => ({ value: option, label: option })),
        value,
        onSelect: (next: string) => emit({ ...values, [field.id]: next }),
      }
    }
    if (field.type === 'boolean') {
      return {
        name: field.id,
        label: field.label || field.fieldName,
        variant: 'list',
        options: [
          { value: 'true', label: '开' },
          { value: 'false', label: '关' },
        ],
        value: String(value).toLowerCase() === 'true' ? 'true' : 'false',
        onSelect: (next: string) => emit({ ...values, [field.id]: next }),
      }
    }
    if (field.type === 'number' && field.min !== null && field.max !== null) {
      return {
        name: field.id,
        label: field.label || field.fieldName,
        variant: 'slider',
        options: [],
        value,
        min: field.min,
        max: field.max,
        step: field.step ?? 1,
        onSelect: (next: string) => emit({ ...values, [field.id]: next }),
      }
    }
    return {
      name: field.id,
      label: field.label || field.fieldName,
      variant: 'text',
      options: [],
      value,
      placeholder: field.type === 'number' ? '数字' : '填写值',
      onSelect: (next: string) => emit({ ...values, [field.id]: next }),
    }
  })

  return (
    <>
      <ParamPicker
        name="workflowChannel"
        ariaLabel="工作流渠道"
        label={channel.name}
        options={channels.map((item) => ({ value: item.id, label: item.name }))}
        value={channel.id}
        variant="list"
        open={openPicker === 'workflowChannel'}
        onToggle={() => onTogglePicker('workflowChannel')}
        onClose={onClosePicker}
        onSelect={(next: string) => onEvent({ type: 'setChannel', channelId: next })}
        disabled={disabled === true}
      />
      <ParamPicker
        name="model"
        ariaLabel="工作流条目"
        label={entry?.title ?? '选择工作流'}
        options={entries.map((item) => ({ value: workflowModelId(item.id), label: item.title }))}
        value={data.model ?? ''}
        variant="list"
        open={openPicker === 'model'}
        onToggle={() => onTogglePicker('model')}
        onClose={onClosePicker}
        onSelect={(next: string) => onEvent({ type: 'setModel', model: next, channelId: channel.id })}
        disabled={disabled === true}
      />
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
      {media.map((field: WorkflowParamField) => (
        <span key={field.id} className={styles.mediaChip} title="运行时使用上游素材">
          {field.label || field.fieldName}
          <span className={styles.mediaState}>{field.required ? '必选 · 用上游' : '用上游'}</span>
        </span>
      ))}
      {sections.length > 0 ? (
        <ParamPicker
          name="workflowParams"
          ariaLabel="工作流参数"
          label={`参数 ${plain.length}`}
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
