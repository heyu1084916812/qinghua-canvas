import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Channel } from '../../domain/project/channel'
import type { ChannelStore } from '../../state/channel/channelStore'
import type { PlatformKit } from '../../platform/ports'
import {
  workflowModelId,
  type WorkflowEntry,
} from '../../domain/project/workflowParams'
import { workflowEntryCategory } from '../../domain/project/workflowParamValues'
import type { ModelCapability } from '../../domain/shared/capability'
import { createWorkflowEntryStore } from '../../state/channel/workflowEntryStore'
import { fetchWorkflowFields, fetchAppBundle } from '../../platform/channels/runninghubWorkflow'
import {
  fetchRhMarketEntries,
  fetchRhMarketRelatedId,
  runtimeOnly,
  RH_MARKET_DEFAULT_HOST,
  type RhMarketEntry,
} from '../../platform/channels/runninghubMarket'
import { WorkflowFieldEditor } from './WorkflowFieldEditor'
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
}

function kindOfId(raw: string): { id: string; kind: 'workflow' | 'app' } | null {
  const text = raw.trim()
  if (!text) return null
  const app = /(?:ai-app|webapp)\/(\d{6,})/.exec(text)
  if (app) return { id: app[1], kind: 'app' }
  const flow = /workflow\/(\d{6,})/.exec(text)
  if (flow) return { id: flow[1], kind: 'workflow' }
  const bare = /^(\d{6,})$/.exec(text)
  return bare ? { id: bare[1], kind: 'workflow' } : null
}

export function SettingsWorkflowManager({
  channel,
  groupId,
  channels,
  platform,
}: SettingsWorkflowManagerProps) {
  const store = useMemo(() => createWorkflowEntryStore(platform.storage), [platform.storage])
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState<WorkflowEntry[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [marketOpen, setMarketOpen] = useState(false)
  const [market, setMarket] = useState<RhMarketEntry[]>([])

  useEffect(() => {
    void store.load(channel.id).then(setEntries)
  }, [channel.id, store])

  const persist = useCallback(
    async (next: WorkflowEntry[]) => {
      setEntries(next)
      await store.save(channel.id, next)
    },
    [channel.id, store],
  )

  const modelsNow = useCallback(() => {
    const group = groupId ? channel.credentialGroups.find((item) => item.id === groupId) : null
    return group ? group.models : channel.models
  }, [channel, groupId])

  const registerModel = useCallback(
    async (entry: WorkflowEntry, remove = false) => {
      const id = entry.kind === 'app' ? `app:${entry.id}` : workflowModelId(entry.id)
      const current = modelsNow()
      const next = remove
        ? current.filter((model) => model.id !== id)
        : current.some((model) => model.id === id)
          ? current
          : [...current, { id, category: workflowEntryCategory(entry), inputTypes: ['text', 'image'] as ModelCapability['inputTypes'] }]
      await channels.setModels(channel.id, [...next], groupId)
    },
    [channel.id, channels, groupId, modelsNow],
  )

  const pullFields = useCallback(
    async (id: string, kind: 'workflow' | 'app') => {
      const key = await channels.loadToken(channel.id)
      if (!key) throw new Error('先在上面填好这条渠道的 API Key —— 拉参数要用它')
      const endpoint = { host: channel.baseUrl || RH_MARKET_DEFAULT_HOST, apiKey: key }
      const signal = AbortSignal.timeout(30_000)
      if (kind === 'app') {
        const bundle = await fetchAppBundle({ network: platform.network }, endpoint, id, signal)
        return {
          fields: bundle.fields,
          title: bundle.meta.title,
          coverUrl: bundle.meta.coverUrl,
        }
      }
      return { fields: await fetchWorkflowFields({ network: platform.network }, endpoint, id, signal), title: '', coverUrl: undefined }
    },
    [channel.baseUrl, channel.id, channels, platform.network],
  )

  const addEntry = useCallback(
    async (id: string, kind: 'workflow' | 'app', title?: string, coverUrl?: string, note?: string) => {
      setBusy(true)
      setError('')
      setNotice('')
      try {
        const pulled = await pullFields(id, kind)
        const entry: WorkflowEntry = {
          id,
          kind,
          title: title || pulled.title || `${kind === 'app' ? 'AI 应用' : '工作流'} ${id}`,
          provider: 'runninghub',
          fields: pulled.fields,
          fetchedAt: Date.now(),
          ...(note ? { note } : {}),
          ...(coverUrl || pulled.coverUrl ? { coverUrl: coverUrl ?? pulled.coverUrl } : {}),
        }
        const next = [...entries.filter((item) => !(item.id === id && (item.kind ?? 'workflow') === kind)), entry]
        await persist(next)
        await registerModel(entry)
        setNotice(`已导入「${entry.title}」：${pulled.fields.length} 个可改参数`)
        setInput('')
        return true
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        return false
      } finally {
        setBusy(false)
      }
    },
    [entries, persist, pullFields, registerModel],
  )

  const removeEntry = useCallback(
    async (entry: WorkflowEntry) => {
      await persist(entries.filter((item) => !(item.id === entry.id && (item.kind ?? 'workflow') === (entry.kind ?? 'workflow'))))
      await registerModel(entry, true)
      setNotice(`已删除「${entry.title}」`)
    },
    [entries, persist, registerModel],
  )

  const patchEntry = useCallback(
    async (entry: WorkflowEntry, patch: Partial<WorkflowEntry>) => {
      const next = entries.map((item) =>
        item.id === entry.id && (item.kind ?? 'workflow') === (entry.kind ?? 'workflow')
          ? { ...item, ...patch }
          : item,
      )
      await persist(next)
    },
    [entries, persist],
  )

  const openMarket = useCallback(async () => {
    setMarketOpen(true)
    setError('')
    try {
      const list = await fetchRhMarketEntries(
        platform,
        { kind: 'WORKFLOW', host: channel.baseUrl || RH_MARKET_DEFAULT_HOST },
        AbortSignal.timeout(30_000),
      )
      setMarket(runtimeOnly(list))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [channel.baseUrl, platform])

  const addFromMarket = useCallback(
    async (item: RhMarketEntry) => {
      setBusy(true)
      try {
        const workflowId = await fetchRhMarketRelatedId(
          platform,
          item.skuId,
          { host: channel.baseUrl || RH_MARKET_DEFAULT_HOST },
          AbortSignal.timeout(30_000),
        )
        await addEntry(workflowId, 'workflow', item.title, item.coverUrl)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
    },
    [addEntry, channel.baseUrl, platform],
  )

  const apps = entries.filter((entry) => entry.kind === 'app')
  const workflows = entries.filter((entry) => (entry.kind ?? 'workflow') === 'workflow')
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
    const exposed = editing.fields.filter((field) => field.enabled).length
    return (
      <section className={styles.manager} data-workflow-entry-settings={editing.id}>
        <div className={styles.head}>
          <div className={styles.headText}>
            <span className={styles.title}>{editing.title}</span>
            <span className={styles.sub}>
              {editing.kind === 'app' ? '/run/ai-app/' : '/run/workflow/'}
              {editing.id}
            </span>
          </div>
          <button type="button" className={styles.linkBtn} onClick={() => setEditingId(null)}>
            返回列表
          </button>
        </div>
        <div className={styles.editor}>
          <div className={styles.previewPane}>
            <label className={styles.field}>
              <span className={styles.label}>名称</span>
              <input
                className={styles.input}
                value={editing.title}
                onChange={(event) => void patchEntry(editing, { title: event.target.value })}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>备注</span>
              <textarea
                className={styles.previewTextarea}
                rows={4}
                value={editing.note ?? ''}
                onChange={(event) => void patchEntry(editing, { note: event.target.value })}
              />
            </label>
            <div className={styles.countRow}>
              <span className={styles.countBox}>
                <b>{editing.fields.length}</b>
                <span>全部参数</span>
              </span>
              <span className={styles.countBox}>
                <b>{exposed}</b>
                <span>已暴露参数</span>
              </span>
            </div>
            {editing.kind !== 'app' ? (
              <label className={styles.field}>
                <span className={styles.label}>输出类型</span>
                <select
                  className={styles.selectSm}
                  value={editing.outputKind ?? workflowEntryCategory(editing)}
                  onChange={(event) =>
                    void patchEntry(editing, { outputKind: event.target.value === 'video' ? 'video' : 'image' })
                  }
                >
                  <option value="image">图片</option>
                  <option value="video">视频</option>
                </select>
              </label>
            ) : null}
          </div>
          <div className={styles.fieldPane}>
            <WorkflowFieldEditor
              entry={editing}
              busy={busy}
              showPreview={false}
              onClose={() => setEditingId(null)}
              onSave={async (fields) => {
                await patchEntry(editing, { fields })
                await registerModel({ ...editing, fields })
                setEditingId(null)
                setNotice(`「${editing.title}」参数已保存`)
              }}
            />
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className={styles.manager} data-workflow-manager>
      <div className={styles.head}>
        <div className={styles.headText}>
          <span className={styles.title}>AI 应用和工作流</span>
          <span className={styles.sub}>粘贴 /run/ai-app/… 或 /run/workflow/… 导入；设置会保存到本条渠道</span>
        </div>
        <button type="button" className={styles.linkBtn} onClick={() => setOpen(false)}>
          收起
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
          disabled={busy || !input.trim()}
          onClick={() => {
            const parsed = kindOfId(input)
            if (!parsed) {
              setError('认不出这个链接：要 /run/ai-app/… 或 /run/workflow/…，或纯数字 id')
              return
            }
            void addEntry(parsed.id, parsed.kind)
          }}
        >
          导入
        </button>
        <button type="button" className={styles.btn} disabled={busy} onClick={() => void openMarket()}>
          从市场导入
        </button>
      </div>

      {error ? <p className={styles.error}>{error}</p> : null}
      {notice ? <p className={styles.notice}>{notice}</p> : null}

      {marketOpen ? (
        <div className={styles.market} data-workflow-market>
          <div className={styles.marketHead}>
            <span className={styles.marketTitle}>市场 · 工作流（只扣运行时长）</span>
            <button type="button" className={styles.linkBtn} onClick={() => setMarketOpen(false)}>
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
                <button type="button" className={styles.btn} disabled={busy} onClick={() => void addFromMarket(item)}>
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
                      卡片只**读**：名称与备注都在「设置」里改（参考产品就是这样的分工）。
                      原来这里挂着输入框和备注框，一张卡被撑成半屏，还容易改到一半就走人。
                    */}
                    <span className={styles.cardTitle}>{entry.title}</span>
                    {/* id 太长会把窄栏挤成两行，这里只留「几个参数」；完整 id 在设置页抬头 */}
                    <span className={styles.meta}>{entry.fields.length} 个参数</span>
                    {entry.note ? <span className={styles.cardNote}>{entry.note}</span> : null}
                  </div>
                  <div className={styles.actions}>
                    <button type="button" className={styles.linkBtn} onClick={() => setEditingId(entry.id)}>
                      设置
                    </button>
                    <button type="button" className={styles.linkBtn} onClick={() => void removeEntry(entry)}>
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
