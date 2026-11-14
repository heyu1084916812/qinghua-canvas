import { useCallback, useEffect, useState } from 'react'
import type { Channel } from '../../domain/project/channel'
import type { ChannelStore } from '../../state/channel/channelStore'
import type { PlatformKit } from '../../platform/ports'
import type { ModelCapability } from '../../domain/shared/capability'
import {
  mergeRefetchedFields,
  workflowModelId,
  type WorkflowEntry,
} from '../../domain/project/workflowParams'
import { workflowEntryCategory } from '../../domain/project/workflowParamValues'
import { createWorkflowEntryStore } from '../../state/channel/workflowEntryStore'
import {
  fetchRhMarketEntries,
  fetchRhMarketRelatedId,
  runtimeOnly,
  RH_MARKET_DEFAULT_HOST,
  type RhMarketEntry,
} from '../../platform/channels/runninghubMarket'
import { fetchWorkflowFields } from '../../platform/channels/runninghubWorkflow'
import { WorkflowFieldEditor } from './WorkflowFieldEditor'
import styles from './SettingsWorkflowEntries.module.css'

/**
 * RunningHub 渠道的「工作流条目」（对账 #1113 / #1104）。
 *
 * 用户要的「免费版」= **只扣运行时长**的那批（市场卡片上没有"标准模型API调用费用"）：
 * 设置页这里从市场目录挑、或者直接填 `workflowId`，拉回全量参数后存成一条条目，
 * 生成节点的模型下拉里就会多出一行 `workflow:<id>`（执行端见 `runninghub.ts` 的 `runWorkflow`）。
 *
 * 为什么组件自己管状态：它只依赖「渠道 + 存储 + 网络」三样，塞进 SettingsPage 的
 * 那一大串 props 里只会让两边都更难读。
 *
 * ⚠️ 本轮**不做**「参数暴露/隐藏面板」（对账 #1106）：节点先按工作流自己的默认值跑。
 */
export type SettingsWorkflowEntriesProps = {
  channel: Channel
  groupId?: string
  channels: ChannelStore
  platform: PlatformKit
}

export function SettingsWorkflowEntries({
  channel,
  groupId,
  channels,
  platform,
}: SettingsWorkflowEntriesProps) {
  const store = createWorkflowEntryStore(platform.storage)
  const [entries, setEntries] = useState<WorkflowEntry[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [marketOpen, setMarketOpen] = useState(false)
  const [marketLoading, setMarketLoading] = useState(false)
  const [market, setMarket] = useState<RhMarketEntry[]>([])
  const [manualId, setManualId] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void store.load(channel.id).then((loaded) => {
      if (alive) setEntries(loaded)
    })
    return () => {
      alive = false
    }
  }, [channel.id])

  const persist = useCallback(
    async (next: WorkflowEntry[]) => {
      setEntries(next)
      await store.save(channel.id, next)
    },
    [channel.id],
  )

  const modelsNow = useCallback(() => {
    const group = groupId ? channel.credentialGroups.find((item) => item.id === groupId) : null
    return group ? group.models : channel.models
  }, [channel, groupId])

  const registerModel = useCallback(
    async (entry: WorkflowEntry, remove = false) => {
      const id = workflowModelId(entry.id)
      const current = modelsNow()
      const next = remove
        ? current.filter((model) => model.id !== id)
        : current.some((model) => model.id === id)
          ? current
          : [
              ...current,
              {
                id,
                category: workflowEntryCategory(entry),
                inputTypes: ['text', 'image'] as ModelCapability['inputTypes'],
              },
            ]
      await channels.setModels(channel.id, [...next], groupId)
    },
    [channel.id, channels, groupId, modelsNow],
  )

  const pullFields = useCallback(
    async (workflowId: string) => {
      /* 槽位不写死：RunningHub 只有一把 Key，`loadToken` 自己的默认槽就是它 */
      const key = await channels.loadToken(channel.id)
      if (!key) throw new Error('先在上面填好这条渠道的 API Key —— 拉参数要用它')
      return fetchWorkflowFields(
        { network: platform.network },
        { host: channel.baseUrl || RH_MARKET_DEFAULT_HOST, apiKey: key },
        workflowId,
        AbortSignal.timeout(30_000),
      )
    },
    [channel.baseUrl, channel.id, channels, platform.network],
  )

  const addEntry = useCallback(
    async (input: { workflowId: string; title: string; coverUrl?: string }) => {
      setBusy(true)
      setError('')
      setNotice('')
      try {
        const fields = await pullFields(input.workflowId)
        const entry: WorkflowEntry = {
          id: input.workflowId,
          title: input.title || `工作流 ${input.workflowId}`,
          provider: 'runninghub',
          fields,
          fetchedAt: Date.now(),
          ...(input.coverUrl ? { coverUrl: input.coverUrl } : {}),
        }
        const next = [...entries.filter((item) => item.id !== entry.id), entry]
        await persist(next)
        await registerModel(entry)
        setNotice(`已添加「${entry.title}」：${fields.length} 个可改参数（生成节点里选它即可）`)
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

  const addFromMarket = useCallback(
    async (item: RhMarketEntry) => {
      setBusy(true)
      setError('')
      setNotice('')
      try {
        /**
         * 市场 id 是 **SKU id**，真实 `workflowId` 在详情的 `relatedDataId` 里
         * （见 `runninghubMarket.ts` 的说明）。
         */
        const workflowId = await fetchRhMarketRelatedId(
          platform,
          item.skuId,
          { host: channel.baseUrl || RH_MARKET_DEFAULT_HOST },
          AbortSignal.timeout(30_000),
        )
        await addEntry({ workflowId, title: item.title, coverUrl: item.coverUrl })
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
    },
    [addEntry, channel.baseUrl, platform],
  )

  const openMarket = useCallback(async () => {
    setMarketOpen(true)
    setMarketLoading(true)
    setError('')
    try {
      const list = await fetchRhMarketEntries(
        platform,
        { kind: 'WORKFLOW', host: channel.baseUrl || RH_MARKET_DEFAULT_HOST },
        AbortSignal.timeout(30_000),
      )
      /* 用户口径：先只做「只扣运行时长」那批 */
      setMarket(runtimeOnly(list))
    } catch (e) {
      setMarket([])
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setMarketLoading(false)
    }
  }, [channel.baseUrl, platform])

  const removeEntry = useCallback(
    async (entry: WorkflowEntry) => {
      setNotice('')
      setError('')
      await persist(entries.filter((item) => item.id !== entry.id))
      await registerModel(entry, true)
      setNotice(`已删除「${entry.title}」`)
    },
    [entries, persist, registerModel],
  )

  const refreshEntry = useCallback(
    async (entry: WorkflowEntry) => {
      setBusy(true)
      setNotice('')
      setError('')
      try {
        const fields = mergeRefetchedFields(entry.fields, await pullFields(entry.id))
        const next = entries.map((item) =>
          item.id === entry.id ? { ...item, fields, fetchedAt: Date.now() } : item,
        )
        await persist(next)
        setNotice(`「${entry.title}」参数已同步：${fields.length} 个`)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
    },
    [entries, persist, pullFields],
  )

  /** 参数面板保存：字段表整份替换，`workflow:<id>` 的类别跟着「暴露出来的媒体」重算 */
  const saveFields = useCallback(
    async (entry: WorkflowEntry, fields: WorkflowEntry['fields']) => {
      const next = entries.map((item) => (item.id === entry.id ? { ...item, fields } : item))
      await persist(next)
      const updated = next.find((item) => item.id === entry.id)
      if (updated) await registerModel(updated)
      setEditingId(null)
      setNotice(`「${entry.title}」参数已保存：暴露 ${fields.filter((field) => field.enabled).length} 个`)
    },
    [entries, persist, registerModel],
  )

  return (
    <section className={styles.block} data-workflow-entries>
      <div className={styles.head}>
        <div className={styles.headText}>
          <span className={styles.title}>工作流条目</span>
          <span className={styles.sub}>只列「运行时长费用」那批（不叠加第三方模型调用费）</span>
        </div>
        <button type="button" className={styles.btn} onClick={() => void openMarket()} disabled={busy}>
          从市场添加
        </button>
      </div>

      <div className={styles.manualRow}>
        <input
          className={styles.input}
          value={manualId}
          placeholder="也可以直接填 workflowId（19 位数字）"
          onChange={(event) => setManualId(event.target.value)}
        />
        <button
          type="button"
          className={styles.btn}
          disabled={busy || !manualId.trim()}
          onClick={() => void addEntry({ workflowId: manualId.trim(), title: '' })}
        >
          添加
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
          {marketLoading ? <p className={styles.muted}>正在读取市场目录…</p> : null}
          {!marketLoading && market.length === 0 ? (
            <p className={styles.muted}>没有可添加的条目（目录为空或读取失败）</p>
          ) : null}
          <ul className={styles.marketList}>
            {market.map((item) => (
              <li key={item.skuId} className={styles.marketItem}>
                <div className={styles.marketText}>
                  <span className={styles.marketName}>{item.title}</span>
                  <span className={styles.marketMeta}>
                    {item.categoryName} · 运行时长费用
                  </span>
                </div>
                <button
                  type="button"
                  className={styles.btn}
                  disabled={busy}
                  onClick={() => void addFromMarket(item)}
                >
                  添加
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {entries.length === 0 ? (
        <p className={styles.muted}>还没有工作流条目。添加后生成节点的模型下拉里会出现它。</p>
      ) : (
        <ul className={styles.list}>
          {entries.map((entry) => (
            <li key={entry.id} className={styles.item} data-workflow-entry={entry.id}>
              <div className={styles.text}>
                <span className={styles.name}>{entry.title}</span>
                <span className={styles.meta}>
                  {entry.id} · {entry.fields.length} 个参数
                </span>
              </div>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.linkBtn}
                  disabled={busy}
                  onClick={() => setEditingId((current) => (current === entry.id ? null : entry.id))}
                >
                  {editingId === entry.id ? '收起参数' : '参数'}
                </button>
                <button
                  type="button"
                  className={styles.linkBtn}
                  disabled={busy}
                  onClick={() => void refreshEntry(entry)}
                >
                  重新拉参数
                </button>
                <button
                  type="button"
                  className={styles.linkBtn}
                  disabled={busy}
                  onClick={() => void removeEntry(entry)}
                >
                  删除
                </button>
              </div>
              {editingId === entry.id ? (
                <WorkflowFieldEditor
                  entry={entry}
                  busy={busy}
                  onClose={() => setEditingId(null)}
                  onSave={(fields) => saveFields(entry, fields)}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
