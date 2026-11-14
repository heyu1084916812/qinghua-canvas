import { useMemo, useState } from 'react'
import type { WorkflowEntry, WorkflowParamField, WorkflowParamType } from '../../domain/project/workflowParams'
import {
  withKnownOptions,
  WORKFLOW_FIELD_TYPES,
  workflowFieldTypeLabel,
} from '../../domain/project/workflowFieldKinds'
import styles from './SettingsWorkflowEntries.module.css'

/**
 * 工作流条目的「参数暴露 / 隐藏」编辑器（对账 #1106）。
 *
 * **结构复刻 `1685901916/canvas-xiong` 的 RunningHub 工作流编辑器**：
 * 左边是**节点上的效果预览**（勾了什么就长什么样），右边是按节点分组的字段清单，
 * 每个字段可改：暴露开关 / 显示名 / 控件类型 / 候选值 / min·max·step / 图序 / 随机 / 必填。
 *
 * 与参考实现的差异（都是我们这边既定的口径）：
 * - **默认全隐藏**（参考实现拉回来默认全开）—— 工作流会把整份 `inputs` 都给出来，
 *   全开等于把几十个无关参数摊到节点上；面板里给「全部暴露」一键操作兜底；
 * - 类型是我们自己的六类（text / textarea / number / boolean / select / image / video / audio）。
 */
export type WorkflowFieldEditorProps = {
  entry: WorkflowEntry
  busy?: boolean
  onSave: (fields: WorkflowParamField[]) => void | Promise<void>
  onClose: () => void
}

function isMedia(type: WorkflowParamType): boolean {
  return type === 'image' || type === 'video' || type === 'audio'
}

/** 预览与清单共用的排序：媒体按图序在前，其余按节点号数值序 */
function sortFields(fields: readonly WorkflowParamField[]): WorkflowParamField[] {
  return [...fields].sort((a, b) => {
    const am = isMedia(a.type)
    const bm = isMedia(b.type)
    if (am && bm) return (a.mediaOrder || 9999) - (b.mediaOrder || 9999)
    if (am !== bm) return am ? -1 : 1
    return (
      String(a.nodeId).localeCompare(String(b.nodeId), undefined, { numeric: true }) ||
      a.fieldName.localeCompare(b.fieldName)
    )
  })
}

function PreviewControl({ field }: { field: WorkflowParamField }) {
  const label = field.label || field.fieldName
  if (isMedia(field.type)) {
    return (
      <div className={styles.previewField}>
        <div className={styles.previewLabel}>
          {label}
          <span className={styles.previewSlot}>
            {field.type === 'image' ? `图 ${field.mediaOrder || 1}` : field.type} ·{' '}
            {field.required ? '必选' : '可选'}
          </span>
        </div>
        <div className={styles.previewMedia}>点击上传（运行时用上游素材）</div>
      </div>
    )
  }
  if (field.type === 'boolean') {
    return (
      <div className={styles.previewField}>
        <div className={styles.previewLabel}>{label}</div>
        <span className={styles.previewSwitch} data-on={String(field.value).toLowerCase() === 'true'}>
          <span />
        </span>
      </div>
    )
  }
  if (field.type === 'select') {
    return (
      <div className={styles.previewField}>
        <div className={styles.previewLabel}>{label}</div>
        <select className={styles.previewInput} value={field.value} disabled>
          {field.options.length === 0 ? <option>{field.value}</option> : null}
          {field.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>
    )
  }
  if (field.type === 'textarea') {
    return (
      <div className={styles.previewField}>
        <div className={styles.previewLabel}>{label}</div>
        <textarea className={styles.previewTextarea} value={field.value} disabled rows={3} />
      </div>
    )
  }
  return (
    <div className={styles.previewField}>
      <div className={styles.previewLabel}>{label}</div>
      <input className={styles.previewInput} value={field.value} disabled />
    </div>
  )
}

export function WorkflowFieldEditor({ entry, busy, onSave, onClose }: WorkflowFieldEditorProps) {
  const [draft, setDraft] = useState<WorkflowParamField[]>(() => withKnownOptions(entry.fields))
  const [closedGroups, setClosedGroups] = useState<Set<string>>(new Set())

  const enabled = useMemo(() => sortFields(draft.filter((field) => field.enabled)), [draft])
  const groups = useMemo(() => {
    const map = new Map<string, WorkflowParamField[]>()
    for (const field of sortFields(draft)) {
      const key = field.group || `节点 ${field.nodeId}`
      const list = map.get(key) ?? []
      list.push(field)
      map.set(key, list)
    }
    return [...map.entries()]
  }, [draft])

  const patch = (id: string, changes: Partial<WorkflowParamField>) => {
    setDraft((previous) => previous.map((field) => (field.id === id ? { ...field, ...changes } : field)))
  }

  const setAll = (value: boolean) => setDraft((previous) => previous.map((field) => ({ ...field, enabled: value })))

  return (
    <div className={styles.editor} data-workflow-field-editor>
      <div className={styles.previewPane} data-workflow-preview>
        <div className={styles.previewTitle}>{entry.title}</div>
        {enabled.length === 0 ? (
          <p className={styles.muted}>勾选右侧参数后，这里会显示它们在画布节点上的样子</p>
        ) : (
          <div className={styles.previewBody}>
            {enabled.map((field) => (
              <PreviewControl key={field.id} field={field} />
            ))}
          </div>
        )}
      </div>

      <div className={styles.fieldPane}>
        <div className={styles.fieldHead}>
          <span className={styles.marketTitle}>参数（{draft.length}）· 已暴露 {enabled.length}</span>
          <button type="button" className={styles.linkBtn} onClick={() => setAll(true)}>
            全部暴露
          </button>
          <button type="button" className={styles.linkBtn} onClick={() => setAll(false)}>
            全部隐藏
          </button>
        </div>

        <div className={styles.groupList}>
          {groups.map(([group, fields]) => {
            const open = !closedGroups.has(group)
            return (
              <section key={group} className={styles.group} data-workflow-group={group}>
                <button
                  type="button"
                  className={styles.groupHead}
                  onClick={() =>
                    setClosedGroups((previous) => {
                      const next = new Set(previous)
                      if (next.has(group)) next.delete(group)
                      else next.add(group)
                      return next
                    })
                  }
                >
                  {open ? '▾' : '▸'} {group}（{fields.length}）
                </button>
                {open
                  ? fields.map((field) => (
                      <div key={field.id} className={styles.fieldRow} data-workflow-field={field.id}>
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
                            onChange={(event) =>
                              patch(field.id, { type: event.target.value as WorkflowParamType })
                            }
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
                                onChange={(event) =>
                                  patch(field.id, {
                                    min: event.target.value === '' ? null : Number(event.target.value),
                                  })
                                }
                              />
                              <input
                                className={styles.numSm}
                                value={field.max ?? ''}
                                placeholder="max"
                                onChange={(event) =>
                                  patch(field.id, {
                                    max: event.target.value === '' ? null : Number(event.target.value),
                                  })
                                }
                              />
                              <input
                                className={styles.numSm}
                                value={field.step ?? ''}
                                placeholder="step"
                                onChange={(event) =>
                                  patch(field.id, {
                                    step: event.target.value === '' ? null : Number(event.target.value),
                                  })
                                }
                              />
                            </>
                          ) : null}
                          {isMedia(field.type) ? (
                            <input
                              className={styles.numSm}
                              type="number"
                              min={1}
                              value={field.mediaOrder || 1}
                              title="图序"
                              onChange={(event) =>
                                patch(field.id, {
                                  mediaOrder: Math.max(1, Number(event.target.value) || 1),
                                })
                              }
                            />
                          ) : null}
                          <label className={styles.miniToggle}>
                            <input
                              type="checkbox"
                              checked={field.seed}
                              onChange={(event) => patch(field.id, { seed: event.target.checked })}
                            />
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
                    ))
                  : null}
              </section>
            )
          })}
        </div>

        <div className={styles.editorActions}>
          <button type="button" className={styles.btn} onClick={onClose} disabled={busy}>
            取消
          </button>
          <button type="button" className={styles.btnPrimary} onClick={() => void onSave(draft)} disabled={busy}>
            保存参数
          </button>
        </div>
      </div>
    </div>
  )
}
