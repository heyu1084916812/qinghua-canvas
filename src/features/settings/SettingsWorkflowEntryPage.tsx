import type { Channel } from '../../domain/project/channel'
import type { ChannelStore } from '../../state/channel/channelStore'
import type { PlatformKit } from '../../platform/ports'
import type { WorkflowEntry, WorkflowParamField } from '../../domain/project/workflowParams'
import { workflowEntryCategory } from '../../domain/project/workflowParamValues'
import { WorkflowFieldEditor } from './WorkflowFieldEditor'
import { SettingsWorkflowTestRun } from './SettingsWorkflowTestRun'
import styles from './SettingsWorkflowEntries.module.css'

/**
 * 条目设置**整页**（参考图四 / 图五）。
 *
 * 从管理页拆出来的理由：这一页本身就是一组独立交互（名称 / 备注 / 计数 / 输出类型 /
 * 测试运行 + 右侧参数卡或节点图），留在管理组件里会把那个文件顶过预算，
 * 也让「列表」和「详情」两件事混在一个渲染树里。
 */
export function SettingsWorkflowEntryPage({
  entry,
  busy,
  channel,
  groupId,
  channels,
  platform,
  onBack,
  onRefetch,
  onPatch,
  onSaveFields,
}: {
  entry: WorkflowEntry
  busy: boolean
  channel: Channel
  groupId?: string
  channels: ChannelStore
  platform: PlatformKit
  onBack: () => void
  onRefetch: () => void
  onPatch: (entry: WorkflowEntry, patch: Partial<WorkflowEntry>) => void | Promise<void>
  onSaveFields: (fields: WorkflowParamField[]) => void | Promise<void>
}) {
  const exposed = entry.fields.filter((field) => field.enabled).length

  return (
    <section className={styles.manager} data-workflow-entry-settings={entry.id}>
      <div className={styles.head}>
        <div className={styles.headText}>
          <span className={styles.title}>{entry.title}</span>
          <span className={styles.sub}>
            {entry.kind === 'app' ? '/run/ai-app/' : '/run/workflow/'}
            {entry.id} · {entry.fetchedAt ? `参数拉取自 ${new Date(entry.fetchedAt).toLocaleString()}` : '未拉取参数'}
          </span>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.linkBtn} disabled={busy} onClick={onRefetch}>
            重新拉取
          </button>
          <button type="button" className={styles.linkBtn} onClick={onBack}>
            返回列表
          </button>
        </div>
      </div>

      <div className={styles.editor} data-graph={entry.graph ? 'on' : 'off'}>
        <div className={styles.previewPane}>
          <label className={styles.field}>
            <span className={styles.label}>名称</span>
            <input
              className={styles.input}
              value={entry.title}
              onChange={(event) => void onPatch(entry, { title: event.target.value })}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>备注</span>
            <textarea
              className={styles.previewTextarea}
              rows={4}
              value={entry.note ?? ''}
              onChange={(event) => void onPatch(entry, { note: event.target.value })}
            />
          </label>
          <div className={styles.countRow}>
            <span className={styles.countBox}>
              <b>{entry.fields.length}</b>
              <span>全部参数</span>
            </span>
            <span className={styles.countBox}>
              <b>{exposed}</b>
              <span>已暴露参数</span>
            </span>
          </div>
          {entry.kind !== 'app' ? (
            <label className={styles.field}>
              <span className={styles.label}>输出类型</span>
              <select
                className={styles.selectSm}
                value={entry.outputKind ?? workflowEntryCategory(entry)}
                onChange={(event) => void onPatch(entry, { outputKind: event.target.value === 'video' ? 'video' : 'image' })}
              >
                <option value="image">图片</option>
                <option value="video">视频</option>
              </select>
            </label>
          ) : null}
          <SettingsWorkflowTestRun channel={channel} entry={entry} groupId={groupId} channels={channels} platform={platform} />
        </div>
        <div className={styles.fieldPane}>
          <WorkflowFieldEditor entry={entry} busy={busy} showPreview={false} onClose={onBack} onSave={onSaveFields} />
        </div>
      </div>
    </section>
  )
}
