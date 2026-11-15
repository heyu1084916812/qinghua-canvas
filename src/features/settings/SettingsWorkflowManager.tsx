import { parseWorkflowEntryRef } from '../../domain/project/workflowEntryRef'
import { errorTextOf } from '../../shared/result'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Channel } from '../../domain/project/channel'
import type { ChannelStore } from '../../state/channel/channelStore'
import type { PlatformKit } from '../../platform/ports'
import {
  mergeRefetchedFields,
  workflowModelId,
  type WorkflowEntry,
  type WorkflowParamField,
} from '../../domain/project/workflowParams'
import { workflowEntryCategory } from '../../domain/project/workflowParamValues'
import type { ModelCapability } from '../../domain/shared/capability'
import { createWorkflowEntryStore } from '../../state/channel/workflowEntryStore'
import { fetchWorkflowBundle, fetchAppBundle } from '../../platform/channels/runninghubWorkflow'
import {
  fetchRhMarketEntries,
  fetchRhMarketRelatedId,
  runtimeOnly,
  RH_MARKET_DEFAULT_HOST,
  type RhMarketEntry,
} from '../../platform/channels/runninghubMarket'
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
  const store = useMemo(() => createWorkflowEntryStore(platform.storage), [platform.storage])
  const [internalOpen, setInternalOpen] = useState(false)
  const open = openProp ?? internalOpen
  const setOpen = onOpenChange ?? setInternalOpen
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
      /** 读 Key 可能抛（例如桌面壳保存的 DPAPI 凭据在 Web 环境解不开）—— 一律当"没 Key"，给同一句人话 */
      let key: string | null = null
      try {
        key = await channels.loadToken(channel.id)
      } catch {
        key = null
      }
      if (!key) throw new Error('先在上面填好这条渠道的 API Key —— 拉参数要用它')
      const endpoint = { host: channel.baseUrl || RH_MARKET_DEFAULT_HOST, apiKey: key }
      const signal = AbortSignal.timeout(30_000)
      if (kind === 'app') {
        const bundle = await fetchAppBundle({ network: platform.network }, endpoint, id, signal)
        return {
          fields: bundle.fields,
          title: bundle.meta.title,
          coverUrl: bundle.meta.coverUrl,
          graph: undefined,
        }
      }
      /** 工作流一次拿齐字段 + 节点图（同一个响应里都有，别请求两遍） */
      const bundle = await fetchWorkflowBundle({ network: platform.network }, endpoint, id, signal)
      return { fields: bundle.fields, title: '', coverUrl: undefined, graph: bundle.graph }
    },
    [channel.baseUrl, channel.id, channels, platform.network],
  )

  const addEntry = useCallback(
    async (id: string, kind: 'workflow' | 'app', title?: string, coverUrl?: string, note?: string, quiet = false) => {
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
          ...(pulled.graph ? { graph: pulled.graph } : {}),
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
        if (!quiet) setError(errorTextOf(e))
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

  /**
   * 重新拉取（参考图五右上角那颗）：用**上游此刻返回的**节点与参数覆盖快照。
   *
   * 与首次导入走同一个 `pullFields`（真实 `getJsonApiFormat`），差别只在合并策略：
   * 用户勾过的暴露状态 / 改过的显示名要保留（`mergeRefetchedFields`），节点图整份换新。
   */
  const refetch = async (entry: WorkflowEntry) => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const pulled = await pullFields(entry.id, entry.kind ?? 'workflow')
      await patchEntry(entry, {
        fields: mergeRefetchedFields(entry.fields, pulled.fields),
        fetchedAt: Date.now(),
        ...(pulled.graph ? { graph: pulled.graph } : {}),
      })
      setNotice(`已重新拉取：${pulled.fields.length} 个参数`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

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
    return (
      <SettingsWorkflowEntryPage
        entry={editing}
        busy={busy}
        channel={channel}
        groupId={groupId}
        channels={channels}
        platform={platform}
        onBack={() => setEditingId(null)}
        onRefetch={() => void refetch(editing)}
        onPatch={patchEntry}
        onSaveFields={async (fields: WorkflowParamField[]) => {
          await patchEntry(editing, { fields })
          await registerModel({ ...editing, fields })
          setEditingId(null)
          setNotice(`「${editing.title}」参数已保存`)
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
          disabled={busy || !input.trim()}
          onClick={() => {
            const parsed = parseWorkflowEntryRef(input)
            if (!parsed) {
              setError('认不出这个链接：要 /ai-detail/…、/run/ai-app/… 或 /run/workflow/…，或纯数字 id')
              return
            }
            /* 纯数字 id 种类不定：先按工作流拉，拉不到再按应用试（#1128 L4） */
            if (parsed.kind) void addEntry(parsed.id, parsed.kind)
            else void addEntry(parsed.id, 'workflow', undefined, undefined, undefined, true).then((ok) => (ok ? true : addEntry(parsed.id, 'app')))
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
