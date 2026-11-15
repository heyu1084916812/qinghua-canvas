import { useState } from 'react'
import type { Channel } from '../../domain/project/channel'
import type { ChannelStore } from '../../state/channel/channelStore'
import type { PlatformKit } from '../../platform/ports'
import type { WorkflowParamField } from '../../domain/project/workflowParams'
import { useWorkflowEntries } from './useWorkflowEntries'
import { SettingsWorkflowEntryPage } from './SettingsWorkflowEntryPage'
import styles from './SettingsWorkflowEntries.module.css'

/**
 * RunningHub 的「AI 应用和工作流」管理页 + 条目设置页（对账 #1116 P1）。
 *
 * 结构照参考产品：渠道页点按钮进来 → 顶部粘贴链接/id 导入 → 左「AI 应用」右「工作流」
 * 两栏卡片（封面 / 名称 / 备注 / 设置 / 删除）→ 卡片「设置」进条目设置页
 * （左元信息与计数，右参数暴露编辑器）。
 */
export type SettingsWorkflowManagerProps = {
  channel: Channel
  groupId?: string
  channels: ChannelStore
  platform: PlatformKit
  /** 受控展开（渠道页的「AI 应用和工作流」按钮用它把这块打开）；不传就自己管 */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function SettingsWorkflowManager({
  channel,
  groupId,
  channels,
  platform,
  open: openProp,
  onOpenChange,
}: SettingsWorkflowManagerProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const open = openProp ?? internalOpen
  const setOpen = onOpenChange ?? setInternalOpen
  const state = useWorkflowEntries({ channel, groupId, channels, platform })
  const { apps, workflows, entries, busy, ready, error, notice, patchEntry } = state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const marketOpen = state.market !== null
  const market = state.market ?? []
  const editing = entries.find((entry) => entry.id === editingId) ?? null

  if (!open) {
    return (
      <section className={styles.block} data-workflow-manager-entry>
        <div className={styles.head}>
          <div className={styles.headText}>
            <span className={styles.title}>AI 应用和工作流</span>
            <span className={styles.sub}>
              已添加 {apps.length} 个应用 · {workflows.length} 条工作流
            </span>
          </div>
          <button type="button" className={styles.btn} onClick={() => setOpen(true)}>
            进入管理
          </button>
        </div>
      </section>
    )
  }

  if (editing) {
    return (
      <SettingsWorkflowEntryPage
        entry={editing}
        busy={busy}
        channel={channel}
        groupId={groupId}
        channels={channels}
        platform={platform}
        onBack={() => setEditingId(null)}
        onRefetch={() => void state.refetch(editing)}
        onPatch={patchEntry}
        onSaveFields={async (fields: WorkflowParamField[]) => {
          if (await state.saveFields(editing, fields)) setEditingId(null)
        }}
      />
    )
  }

  return (
    <section className={styles.manager} data-workflow-manager>
      <div className={styles.head}>
        <div className={styles.headText}>
          <span className={styles.title}>AI 应用和工作流</span>
          <span className={styles.sub}>粘贴 /run/ai-app/… 或 /run/workflow/… 导入；卡片上可直接改名称与备注</span>
        </div>
        <button type="button" className={styles.linkBtn} onClick={() => setOpen(false)}>
          返回渠道
        </button>
      </div>
      <div className={styles.manualRow}>
        <input
          className={styles.input}
          value={input}
          placeholder="/run/ai-app/… 或 /run/workflow/…（也可只填 id）"
          onChange={(event) => setInput(event.target.value)}
        />
        <button
          type="button"
          className={styles.btnPrimary}
          disabled={busy || !ready || !input.trim()}
          onClick={() => void state.importRef(input).then((entry) => entry && setInput(''))}
        >
          导入
        </button>
        <button type="button" className={styles.btn} disabled={busy || !ready} onClick={() => void state.openMarket()}>
          从市场导入
        </button>
      </div>

      {error ? <p className={styles.error}>{error}</p> : null}
      {notice ? <p className={styles.notice}>{notice}</p> : null}

      {marketOpen ? (
        <div className={styles.market} data-workflow-market>
          <div className={styles.marketHead}>
            <span className={styles.marketTitle}>市场 · 工作流（只扣运行时长）</span>
            <button type="button" className={styles.linkBtn} onClick={state.closeMarket}>
              收起
            </button>
          </div>
          <ul className={styles.marketList}>
            {market.map((item) => (
              <li key={item.skuId} className={styles.marketItem}>
                <div className={styles.marketText}>
                  <span className={styles.marketName}>{item.title}</span>
                  <span className={styles.marketMeta}>{item.categoryName} · 运行时长费用</span>
                </div>
                <button type="button" className={styles.btn} disabled={busy || !ready} onClick={() => void state.addFromMarket(item)}>
                  导入
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className={styles.columns}>
        {(
          [
            ['app', 'AI 应用', apps],
            ['workflow', '工作流', workflows],
          ] as const
        ).map(([kind, label, list]) => (
          <div key={kind} className={styles.column} data-workflow-column={kind}>
            <div className={styles.columnHead}>
              <span className={styles.marketTitle}>{label}</span>
              <span className={styles.muted}>{list.length}</span>
            </div>
            {list.length === 0 ? <p className={styles.muted}>还没有{label}，从上面导入一条。</p> : null}
            <ul className={styles.list}>
              {list.map((entry) => (
                <li key={entry.id} className={styles.card} data-workflow-entry={entry.id}>
                  {entry.coverUrl ? (
                    <img className={styles.cover} src={entry.coverUrl} alt="" />
                  ) : (
                    <span className={styles.coverPlaceholder} aria-hidden="true" />
                  )}
                  <div className={styles.cardText}>
                    {/*
                      参考图三：名称与备注**就在卡片上改**（左侧封面、右侧名称 / 路由 / 备注，
                      最右是齿轮与删除）。上一版把它们收进设置页，扫列表时反而要多点一次。
                    */}
                    <span className={styles.meta}>名称</span>
                    <input
                      className={styles.inputSm}
                      value={entry.title}
                      onChange={(event) => void patchEntry(entry, { title: event.target.value })}
                    />
                    <span className={styles.meta}>
                      #{entry.kind === 'app' ? '/run/ai-app/' : '/run/workflow/'}
                      {entry.id} · {entry.fields.length} 个参数
                    </span>
                    <textarea
                      className={styles.input}
                      rows={2}
                      placeholder="备注、用途、参数说明"
                      value={entry.note ?? ''}
                      onChange={(event) => void patchEntry(entry, { note: event.target.value })}
                    />
                  </div>
                  <div className={styles.actions}>
                    <button type="button" className={styles.linkBtn} onClick={() => setEditingId(entry.id)}>
                      设置
                    </button>
                    <button type="button" className={styles.linkBtn} onClick={() => void state.removeEntry(entry)}>
                      删除
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  )
}
