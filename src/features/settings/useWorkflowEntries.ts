import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { parseWorkflowEntryRef } from '../../domain/project/workflowEntryRef'
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
import { errorTextOf } from '../../shared/result'
import { createWorkflowEntryStore } from '../../state/channel/workflowEntryStore'
import { fetchAppBundle, fetchWorkflowBundle } from '../../platform/channels/runninghubWorkflow'
import {
  fetchRhMarketEntries,
  fetchRhMarketRelatedId,
  runtimeOnly,
  RH_MARKET_DEFAULT_HOST,
  type RhMarketEntry,
} from '../../platform/channels/runninghubMarket'

type Kind = 'workflow' | 'app'
type Transform = (list: WorkflowEntry[]) => WorkflowEntry[]

const kindOf = (entry: Pick<WorkflowEntry, 'kind'>): Kind => (entry.kind === 'app' ? 'app' : 'workflow')
export const sameEntry = (a: Pick<WorkflowEntry, 'id' | 'kind'>, b: Pick<WorkflowEntry, 'id' | 'kind'>) =>
  a.id === b.id && kindOf(a) === kindOf(b)

export interface UseWorkflowEntriesArgs {
  channel: Channel
  groupId?: string
  channels: ChannelStore
  platform: PlatformKit
}

/**
 * 「AI 应用 / 工作流」条目的读写逻辑（#1129，从管理页抽出：独立页面与条目设置页共用）。
 *
 * 写法口径（审查 M7）：每次改动都是一个 `Transform`，**先交给存储串行地作用在库里最新的数据上**
 * （`store.update`），成功后再把同一个 Transform 作用在界面状态上。上一版拿点击当时闭包里的
 * `entries` 整份覆盖，导入等待上游的 2–30 秒里改名 / 删除会被吃掉，删掉的条目还会复活。
 *
 * 首次读取完成前（或读失败）`ready=false`：导入按钮据此禁用，免得拿空列表覆盖已有条目。
 */
export function useWorkflowEntries({ channel, groupId, channels, platform }: UseWorkflowEntriesArgs) {
  const store = useMemo(() => createWorkflowEntryStore(platform.storage), [platform.storage])
  const [entries, setEntries] = useState<WorkflowEntry[]>([])
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [market, setMarket] = useState<RhMarketEntry[] | null>(null)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const reload = useCallback(async () => {
    setReady(false)
    try {
      const loaded = await store.load(channel.id)
      if (!alive.current) return
      setEntries(loaded)
      setReady(true)
    } catch (e) {
      if (!alive.current) return
      setEntries([])
      setError(`${errorTextOf(e)}。为免覆盖已有条目，导入已暂停。`)
    }
  }, [channel.id, store])

  useEffect(() => {
    setError('')
    setNotice('')
    setMarket(null)
    void reload()
  }, [reload])

  /** 存储先改（串行、基于最新数据），成功后界面跟着改；失败报错，不再提示「已保存」 */
  const apply = useCallback(
    async (fn: Transform) => {
      await store.update(channel.id, fn)
      if (alive.current) setEntries((prev) => fn(prev))
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

  const host = channel.baseUrl || RH_MARKET_DEFAULT_HOST

  const pullFields = useCallback(
    async (id: string, kind: Kind) => {
      /** 读 Key 可能抛（例如桌面壳保存的 DPAPI 凭据在 Web 环境解不开）—— 一律当"没 Key"，给同一句人话 */
      let key: string | null = null
      try {
        key = groupId ? await channels.loadCredentialGroupToken(channel.id, groupId) : await channels.loadToken(channel.id)
      } catch {
        key = null
      }
      if (!key) throw new Error('先在渠道页填好这条渠道的 API Key —— 拉参数要用它')
      const endpoint = { host, apiKey: key }
      const signal = AbortSignal.timeout(30_000)
      if (kind === 'app') {
        const bundle = await fetchAppBundle({ network: platform.network }, endpoint, id, signal)
        return { fields: bundle.fields, title: bundle.meta.title, coverUrl: bundle.meta.coverUrl, graph: undefined }
      }
      /** 工作流一次拿齐字段 + 节点图（同一个响应里都有，别请求两遍） */
      const bundle = await fetchWorkflowBundle({ network: platform.network }, endpoint, id, signal)
      return { fields: bundle.fields, title: '', coverUrl: undefined, graph: bundle.graph }
    },
    [channel.id, channels, groupId, host, platform.network],
  )

  const run = useCallback(async <T>(job: () => Promise<T>, quiet = false): Promise<T | null> => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      return await job()
    } catch (e) {
      if (!quiet && alive.current) setError(errorTextOf(e))
      return null
    } finally {
      if (alive.current) setBusy(false)
    }
  }, [])

  const addEntry = useCallback(
    (id: string, kind: Kind, extra: { title?: string; coverUrl?: string; note?: string } = {}, quiet = false) =>
      run(async () => {
        const pulled = await pullFields(id, kind)
        const entry: WorkflowEntry = {
          id,
          kind,
          title: extra.title || pulled.title || `${kind === 'app' ? 'AI 应用' : '工作流'} ${id}`,
          provider: 'runninghub',
          fields: pulled.fields,
          ...(pulled.graph ? { graph: pulled.graph } : {}),
          fetchedAt: Date.now(),
          ...(extra.note ? { note: extra.note } : {}),
          ...(extra.coverUrl || pulled.coverUrl ? { coverUrl: extra.coverUrl ?? pulled.coverUrl } : {}),
        }
        await apply((list) => [...list.filter((item) => !sameEntry(item, entry)), entry])
        await registerModel(entry)
        setNotice(`已导入「${entry.title}」：${pulled.fields.length} 个可改参数`)
        return entry
      }, quiet),
    [apply, pullFields, registerModel, run],
  )

  /** 粘贴的链接 / id → 导入；纯数字 id 种类不定：先按工作流拉，拉不到再按应用试（#1128 L4） */
  const importRef = useCallback(
    async (input: string) => {
      const parsed = parseWorkflowEntryRef(input)
      if (!parsed) {
        setError('认不出这个链接：要 /ai-detail/…、/run/ai-app/… 或 /run/workflow/…，或纯数字 id')
        return null
      }
      if (parsed.kind) return addEntry(parsed.id, parsed.kind)
      return (await addEntry(parsed.id, 'workflow', {}, true)) ?? addEntry(parsed.id, 'app')
    },
    [addEntry],
  )

  const removeEntry = useCallback(
    (entry: WorkflowEntry) =>
      run(async () => {
        await apply((list) => list.filter((item) => !sameEntry(item, entry)))
        await registerModel(entry, true)
        setNotice(`已删除「${entry.title}」`)
        return true
      }),
    [apply, registerModel, run],
  )

  /** 名称 / 备注这类逐键输入：界面先改（不等存储，免得输入框跳字），存储按序跟上 */
  const patchEntry = useCallback(
    async (entry: WorkflowEntry, patch: Partial<WorkflowEntry>) => {
      const fn: Transform = (list) => list.map((item) => (sameEntry(item, entry) ? { ...item, ...patch } : item))
      setEntries(fn)
      try {
        await store.update(channel.id, fn)
      } catch (e) {
        if (alive.current) setError(errorTextOf(e))
      }
    },
    [channel.id, store],
  )

  /**
   * 重新拉取：用**上游此刻返回的**节点与参数覆盖快照；合并对象是**库里最新的**条目
   * （用户勾过的暴露状态 / 改过的显示名保留，`mergeRefetchedFields`），节点图整份换新。
   * 拉取期间条目被删了就不复活。
   */
  const refetch = useCallback(
    (entry: WorkflowEntry) =>
      run(async () => {
        const pulled = await pullFields(entry.id, kindOf(entry))
        const fetchedAt = Date.now()
        await apply((list) =>
          list.map((item) =>
            sameEntry(item, entry)
              ? { ...item, fields: mergeRefetchedFields(item.fields, pulled.fields), fetchedAt, ...(pulled.graph ? { graph: pulled.graph } : {}) }
              : item,
          ),
        )
        setNotice(`已重新拉取：${pulled.fields.length} 个参数（参数清单已按新字段表刷新）`)
        return true
      }),
    [apply, pullFields, run],
  )

  const saveFields = useCallback(
    (entry: WorkflowEntry, fields: WorkflowParamField[]) =>
      run(async () => {
        await apply((list) => list.map((item) => (sameEntry(item, entry) ? { ...item, fields } : item)))
        await registerModel({ ...entry, fields })
        setNotice(`「${entry.title}」参数已保存`)
        return true
      }),
    [apply, registerModel, run],
  )

  const openMarket = useCallback(async () => {
    setMarket([])
    setError('')
    try {
      const list = await fetchRhMarketEntries(platform, { kind: 'WORKFLOW', host }, AbortSignal.timeout(30_000))
      if (alive.current) setMarket(runtimeOnly(list))
    } catch (e) {
      if (alive.current) setError(errorTextOf(e))
    }
  }, [host, platform])

  const addFromMarket = useCallback(
    async (item: RhMarketEntry) => {
      const workflowId = await run(() => fetchRhMarketRelatedId(platform, item.skuId, { host }, AbortSignal.timeout(30_000)))
      if (workflowId) await addEntry(workflowId, 'workflow', { title: item.title, coverUrl: item.coverUrl })
    },
    [addEntry, host, platform, run],
  )

  return {
    entries,
    apps: entries.filter((entry) => entry.kind === 'app'),
    workflows: entries.filter((entry) => kindOf(entry) === 'workflow'),
    ready,
    busy,
    error,
    notice,
    setError,
    market,
    closeMarket: () => setMarket(null),
    reload,
    addEntry,
    importRef,
    removeEntry,
    patchEntry,
    refetch,
    saveFields,
    openMarket,
    addFromMarket,
  }
}

export type WorkflowEntriesState = ReturnType<typeof useWorkflowEntries>
