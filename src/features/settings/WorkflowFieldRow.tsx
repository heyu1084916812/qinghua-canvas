import type { WorkflowParamField, WorkflowParamType } from '../../domain/project/workflowParams'
import { WORKFLOW_FIELD_TYPES, workflowFieldTypeLabel } from '../../domain/project/workflowFieldKinds'
import styles from './SettingsWorkflowEntries.module.css'

/**
 * 一个参数的可编辑行（暴露勾选 / 显示名 / 控件类型 / 候选值 / 范围 / 图序 / 随机 / 必填）。
 *
 * 抽出来是因为它要在**两个地方**出现：老的「按节点分组的参数清单」与新的「节点图里点开节点」
 * 的弹层里。两处各写一份迟早会漂移成「图上能改类型、清单里不能」这种最难查的不一致。
 */
export function WorkflowFieldRow({
  field,
  onPatch,
}: {
  field: WorkflowParamField
  onPatch: (id: string, changes: Partial<WorkflowParamField>) => void
}) {
  const patch = onPatch
  const isMediaType = field.type === 'image' || field.type === 'video' || field.type === 'audio'

  return (
    <div className={styles.fieldRow} data-workflow-field={field.id}>
      <label className={styles.fieldToggle}>
        <input
          type="checkbox"
          checked={field.enabled}
          onChange={(event) => patch(field.id, { enabled: event.target.checked })}
        />
        <span className={styles.fieldName}>{field.label || field.fieldName}</span>
      </label>
      <div className={styles.fieldControls}>
        <input
          className={styles.inputSm}
          value={field.label}
          placeholder="显示名"
          onChange={(event) => patch(field.id, { label: event.target.value })}
        />
        <select
          className={styles.selectSm}
          value={field.type}
          onChange={(event) => patch(field.id, { type: event.target.value as WorkflowParamType, typeEdited: true })}
        >
          {WORKFLOW_FIELD_TYPES.map((type) => (
            <option key={type} value={type}>
              {workflowFieldTypeLabel(type)}
            </option>
          ))}
        </select>
        {field.type === 'select' ? (
          <input
            className={styles.inputSm}
            value={field.options.join(', ')}
            placeholder="候选值，逗号分隔"
            onChange={(event) =>
              patch(field.id, {
                options: event.target.value
                  .split(/[,，\n]/)
                  .map((item) => item.trim())
                  .filter(Boolean),
              })
            }
          />
        ) : null}
        {field.type === 'number' ? (
          <>
            <input
              className={styles.numSm}
              value={field.min ?? ''}
              placeholder="min"
              onChange={(event) => patch(field.id, { min: event.target.value === '' ? null : Number(event.target.value) })}
            />
            <input
              className={styles.numSm}
              value={field.max ?? ''}
              placeholder="max"
              onChange={(event) => patch(field.id, { max: event.target.value === '' ? null : Number(event.target.value) })}
            />
            <input
              className={styles.numSm}
              value={field.step ?? ''}
              placeholder="step"
              onChange={(event) => patch(field.id, { step: event.target.value === '' ? null : Number(event.target.value) })}
            />
          </>
        ) : null}
        {isMediaType ? (
          <input
            className={styles.numSm}
            type="number"
            min={1}
            value={field.mediaOrder || 1}
            title="图序"
            onChange={(event) => patch(field.id, { mediaOrder: Math.max(1, Number(event.target.value) || 1) })}
          />
        ) : null}
        <label className={styles.miniToggle}>
          <input type="checkbox" checked={field.seed} onChange={(event) => patch(field.id, { seed: event.target.checked })} />
          随机
        </label>
        <label className={styles.miniToggle}>
          <input
            type="checkbox"
            checked={field.required}
            onChange={(event) => patch(field.id, { required: event.target.checked })}
          />
          必填
        </label>
      </div>
    </div>
  )
}
