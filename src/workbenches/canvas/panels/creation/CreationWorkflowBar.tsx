import { useContext, useEffect, useMemo, useState } from 'react'
import type { GenerationData } from '../../../../domain/canvas/model/node'
import type { PanelEvent } from '../panelModel'
import type { WorkflowEntry, WorkflowParamField } from '../../../../domain/project/workflowParams'
import { workflowEntryIdOf, workflowModelId } from '../../../../domain/project/workflowParams'
import { createWorkflowEntryStore } from '../../../../state/channel/workflowEntryStore'
import { ChannelStoreContext } from '../../../../app/providers/ChannelStoreProvider'
import { usePlatformOptional } from '../../../../app/providers/PlatformProvider'
import {
  modeOfModel,
  workflowSubmitList,
  workflowValueMap,
  type CreationSourceMode,
} from './creationWorkflowMode'
import styles from './CreationWorkflowBar.module.css'

/**
 * 创作面板上的「渠道 + 模式 + 条目 + 实例 + 暴露参数」一行（对账 #1105 / #1116 的 P4）。
 *
 * 为什么单独一个组件：`CreationPanel.tsx` 贴着 981 行的 legacy 预算，
 * 这边只能加**一行** JSX；所有状态与交互都收在组件内部。
 *
 * 语义：
 * - 模式是**由当前模型 id 反推**的（`workflow:` / `app:` / 其余 = API），不新增节点字段；
 * - 选条目 = `setModel`（模型 id 就是条目身份，路由层不需要理解来源）；
 * - 改参数 = `setWorkflowRun`（把整份 `nodeInfoList` 落进节点，执行期只转发）。
 */

type Mode = CreationSourceMode

const MODES: { id: Mode; label: string }[] = [
  { id: 'api', label: 'API' },
  { id: 'app', label: 'AI 应用' },
  { id: 'flow', label: '工作流' },
]

export type CreationWorkflowBarProps = {
  data: GenerationData
  onEvent: (event: PanelEvent) => void
  disabled?: boolean
}

export function CreationWorkflowBar({ data, onEvent, disabled }: CreationWorkflowBarProps) {
  /* 可选上下文：单测 / 取证壳里没有 Provider 时整条不渲染（面板其余部分照旧） */
  const channels = useContext(ChannelStoreContext)
  const platform = usePlatformOptional()
  const [entriesByChannel, setEntriesByChannel] = useState<Record<string, WorkflowEntry[]>>({})
  const [tick, setTick] = useState(0)

  /* 渠道启用/新增时跟着变（渠道店不是 React state，订阅一次即可） */
  useEffect(
    () => (channels ? channels.subscribe(() => setTick((value) => value + 1)) : undefined),
    [channels],
  )

  const allChannels = channels ? channels.getState().channels : []
  const rhChannels = useMemo(
    () => allChannels.filter((channel) => channel.protocol === 'runninghub-api'),
    [allChannels, tick],
  )
  const channelIds = rhChannels.map((channel) => channel.id).join(',')

  useEffect(() => {
    if (!platform) return
    let alive = true
    const store = createWorkflowEntryStore(platform.storage)
    const ids = channelIds ? channelIds.split(',') : []
    void Promise.all(ids.map(async (id) => [id, await store.load(id)] as const)).then((pairs) => {
      if (alive) setEntriesByChannel(Object.fromEntries(pairs))
    })
    return () => {
      alive = false
    }
  }, [channelIds, platform?.storage])

  if (!channels || !platform) return null
  if (rhChannels.length === 0) return null

  const channelId = data.channelId && rhChannels.some((c) => c.id === data.channelId)
    ? data.channelId
    : rhChannels[0].id
  const channel = rhChannels.find((c) => c.id === channelId)
  const entries = entriesByChannel[channelId] ?? []
  const model = data.model ?? ''
  const mode = modeOfModel(model)
  const workflowId = workflowEntryIdOf(model)
  const entry = entries.find((item) => item.id === workflowId) ?? null
  const values = workflowValueMap(data)

  const apiModels = (channel?.models ?? []).filter(
    (item) => !item.id.startsWith('app:') && !item.id.startsWith('workflow:'),
  )
  const appModels = (channel?.models ?? []).filter((item) => item.id.startsWith('app:'))
  const disabledAll = disabled === true

  const pickMode = (next: Mode) => {
    if (next === 'api') onEvent({ type: 'setModel', model: apiModels[0]?.id ?? '', channelId })
    else if (next === 'app') onEvent({ type: 'setModel', model: appModels[0]?.id ?? '', channelId })
    else if (entries[0]) onEvent({ type: 'setModel', model: workflowModelId(entries[0].id), channelId })
  }

  /** 把「已暴露字段 + 当前值」拼成整份提交体（执行期原样转发） */
  const emitRun = (nextValues: Record<string, string>, instance?: 'default' | 'plus') => {
    if (!entry) return
    onEvent({
      type: 'setWorkflowRun',
      list: workflowSubmitList(entry, nextValues),
      instance: instance ?? (data.workflowInstance === 'plus' ? 'plus' : 'default'),
    })
  }

  const setValue = (field: WorkflowParamField, value: string) => {
    emitRun({ ...values, [field.id]: value })
  }

  return (
    <section className={styles.bar} data-creation-workflow-bar>
      <label className={styles.pick}>
        <span className={styles.label}>渠道</span>
        <select
          className={styles.select}
          value={channelId}
          disabled={disabledAll}
          onChange={(event) => onEvent({ type: 'setChannel', channelId: event.target.value })}
        >
          {rhChannels.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>

      <div className={styles.seg} role="group" aria-label="生成模式">
        {MODES.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={mode === item.id}
            disabled={disabledAll}
            onClick={() => pickMode(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <label className={styles.pick}>
        <span className={styles.label}>{mode === 'flow' ? '条目' : '模型'}</span>
        <select
          className={styles.select}
          value={model}
          disabled={disabledAll}
          onChange={(event) => onEvent({ type: 'setModel', model: event.target.value, channelId })}
        >
          {mode === 'flow' ? (
            entries.length === 0 ? (
              <option value="">先到设置里添加工作流条目</option>
            ) : (
              entries.map((item) => (
                <option key={item.id} value={workflowModelId(item.id)}>
                  {item.title}
                </option>
              ))
            )
          ) : mode === 'app' ? (
            appModels.length === 0 ? (
              <option value="">这个渠道还没有 AI 应用</option>
            ) : (
              appModels.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.id.replace(/^app:/, '应用 ')}
                </option>
              ))
            )
          ) : apiModels.length === 0 ? (
            <option value="">先拉取模型</option>
          ) : (
            apiModels.map((item) => (
              <option key={item.id} value={item.id}>
                {item.id}
              </option>
            ))
          )}
        </select>
      </label>

      {mode === 'flow' ? (
        <label className={styles.pick}>
          <span className={styles.label}>实例</span>
          <select
            className={styles.select}
            value={data.workflowInstance === 'plus' ? 'plus' : 'default'}
            disabled={disabledAll}
            onChange={(event) => emitRun(values, event.target.value === 'plus' ? 'plus' : 'default')}
          >
            <option value="default">24G</option>
            <option value="plus">48G</option>
          </select>
        </label>
      ) : null}

      {mode === 'flow' && entry ? (
        <div className={styles.fields} data-creation-workflow-fields>
          {entry.fields.filter((field) => field.enabled).length === 0 ? (
            <span className={styles.hint}>这条工作流还没有暴露参数（在设置 → 工作流条目 → 参数里勾选）</span>
          ) : (
            entry.fields
              .filter((field) => field.enabled)
              .map((field) => (
                <label key={field.id} className={styles.field}>
                  <span className={styles.label}>{field.label || field.fieldName}</span>
                  {field.type === 'select' ? (
                    <select
                      className={styles.select}
                      value={values[field.id] ?? field.value}
                      disabled={disabledAll}
                      onChange={(event) => setValue(field, event.target.value)}
                    >
                      {field.options.length === 0 ? (
                        <option value={field.value}>{field.value}</option>
                      ) : null}
                      {field.options.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  ) : field.type === 'boolean' ? (
                    <input
                      type="checkbox"
                      checked={String(values[field.id] ?? field.value).toLowerCase() === 'true'}
                      disabled={disabledAll}
                      onChange={(event) => setValue(field, String(event.target.checked))}
                    />
                  ) : field.type === 'image' || field.type === 'video' || field.type === 'audio' ? (
                    <span className={styles.media}>
                      {field.required ? '必选' : '可选'} · 用上游素材
                    </span>
                  ) : (
                    <input
                      className={styles.select}
                      type={field.type === 'number' ? 'number' : 'text'}
                      value={values[field.id] ?? field.value}
                      disabled={disabledAll}
                      onChange={(event) => setValue(field, event.target.value)}
                    />
                  )}
                </label>
              ))
          )}
        </div>
      ) : null}
    </section>
  )
}
