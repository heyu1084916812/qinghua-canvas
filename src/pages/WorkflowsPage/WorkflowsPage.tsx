import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useChannels } from '../../app/providers/ChannelStoreProvider'
import { usePlatform } from '../../app/providers/PlatformProvider'
import type { Channel } from '../../domain/project/channel'
import { runninghubSiteOf } from '../../domain/project/runninghubSite'
import { parseWorkflowsPageQuery, workflowsPagePath, type WorkflowsTab } from '../../domain/project/workflowsPage'
import { noticeA11y } from '../../domain/ui/notice'
import { SettingsWorkflowEntryPage } from '../../features/settings/SettingsWorkflowEntryPage'
import { useWorkflowEntries } from '../../features/settings/useWorkflowEntries'
import { ChoicePicker } from '../../features/shared/choicePicker/ChoicePicker'
import type { WorkflowEntry } from '../../domain/project/workflowParams'
import { openChannelSettings } from '../../state/ui/globalSettings'
import { WorkflowEntryGrid } from './WorkflowEntryGrid'
import styles from './WorkflowsPage.module.css'

/** 能管 AI 应用 / 工作流的渠道：RunningHub 协议（国内站 / 国际站各一条，用户也可能自建） */
export function workflowChannelsOf(channels: readonly Channel[]): Channel[] {
  return channels.filter((channel) => channel.protocol === 'runninghub-api' || channel.protocol === 'comfyui-local')
}

export function workflowChannelLabel(channel: Channel): string {
  if (channel.protocol === 'comfyui-local') return '本地 ComfyUI'
  const site = runninghubSiteOf(channel.baseUrl)
  return site === 'cn' ? '国内站' : site === 'global' ? '国际站' : channel.name
}

/** 与渠道页「当前 Key 分组」同一口径：优先级最高的那组 */
const topGroupIdOf = (channel: Channel) =>
  [...channel.credentialGroups].sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt)[0]?.id

/**
 * 「AI 应用 / 工作流」独立页（#1131）。
 *
 * 结构照技能库（`/skills`）：顶部两个标签「AI 应用 / 工作流」，右侧切换国内站 / 国际站
 * （两站是两个账号、两把 Key，条目各自独立）；下面一行导入，再下面卡片网格；
 * 点卡片进条目设置（与渠道页原来那一页是同一个组件）。
 *
 * 渠道页只留「连接 + Key + 入口」，条目管理全部在这里——管理页原先塞在渠道表单里，
 * 打开时要把侧栏、选路、模型列表整页藏掉，层级很别扭。
 */
export function WorkflowsPage() {
  const channels = useChannels()
  const platform = usePlatform()
  const navigate = useNavigate()
  const location = useLocation()
  const query = useMemo(() => parseWorkflowsPageQuery(location.search), [location.search])
  const all = useSyncExternalStore(channels.subscribe, () => channels.getState().channels, () => channels.getState().channels)
  const options = useMemo(() => workflowChannelsOf(all), [all])
  const channel = options.find((item) => item.id === query.channelId) ?? options[0] ?? null
  const tab: WorkflowsTab = query.tab

  const go = (next: Partial<typeof query>) =>
    navigate(workflowsPagePath({ ...query, channelId: channel?.id ?? null, ...next }), { replace: true })

  if (!channel) {
    return (
      <div className={styles.page} data-workflows-page>
        <p className={styles.empty}>还没有 RunningHub 渠道。去「渠道配置」添加一条 RunningHub（API）渠道后再回来。</p>
      </div>
    )
  }
  return (
    <WorkflowsChannelView
      key={channel.id}
      channel={channel}
      options={options}
      tab={tab}
      entryId={query.entryId}
      onTab={(next) => go({ tab: next, entryId: null })}
      onChannel={(id) => go({ channelId: id, entryId: null })}
      onEntry={(entry) => go({ entryId: entry?.id ?? null, ...(entry ? { tab: entry.kind === 'app' ? 'app' : 'workflow' } : {}) })}
      onOpenSettings={() => openChannelSettings(channel.id)}
      channels={channels}
      platform={platform}
    />
  )
}

function WorkflowsChannelView({
  channel,
  options,
  tab,
  entryId,
  onTab,
  onChannel,
  onEntry,
  onOpenSettings,
  channels,
  platform,
}: {
  channel: Channel
  options: readonly Channel[]
  tab: WorkflowsTab
  entryId: string | null
  onTab: (tab: WorkflowsTab) => void
  onChannel: (id: string) => void
  onEntry: (entry: WorkflowEntry | null) => void
  onOpenSettings: () => void
  channels: ReturnType<typeof useChannels>
  platform: ReturnType<typeof usePlatform>
}) {
  const groupId = topGroupIdOf(channel)
  const state = useWorkflowEntries({ channel, groupId, channels, platform })
  const [input, setInput] = useState('')
  const editing = entryId ? state.entries.find((entry) => entry.id === entryId && (entry.kind === 'app' ? 'app' : 'workflow') === tab) ?? null : null
  /** 地址里指向的条目不存在（被删 / 换了站）：读完后回到列表，不停在空白页 */
  useEffect(() => {
    if (state.ready && entryId && !editing) onEntry(null)
  }, [editing, entryId, onEntry, state.ready])

  const isComfyUi = channel.protocol === 'comfyui-local'
  const hasKey = isComfyUi || channel.hasToken || channel.credentialGroups.some((group) => group.hasToken)
  const list = tab === 'app' ? state.apps : state.workflows

  return (
    <div className={styles.page} data-workflows-page data-workflows-channel={channel.id}>
      {editing ? (
        <div className={styles.editStage} data-workflows-edit-stage>
          <SettingsWorkflowEntryPage
            entry={editing}
            busy={state.busy}
            channel={channel}
            groupId={groupId}
            channels={channels}
            platform={platform}
            onBack={() => onEntry(null)}
            onRefetch={() => void state.refetch(editing)}
            onPatch={state.patchEntry}
            onSaveFields={async (fields) => {
              if (await state.saveFields(editing, fields)) onEntry(null)
            }}
          />
        </div>
      ) : (
        <>
          <div className={styles.topBar}>
            <div className={styles.tabs} role="tablist" aria-label="条目类型">
              {(
                [
                  ['app', 'AI 应用', state.apps.length],
                  ['workflow', '工作流', state.workflows.length],
                ] as const
              ).map(([key, label, count]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={tab === key}
                  className={tab === key ? styles.tabOn : styles.tab}
                  onClick={() => onTab(key)}
                  data-workflows-tab={key}
                >
                  {label}
                  <span>{state.ready ? count : '…'}</span>
                </button>
              ))}
            </div>
            {/* 站点切换用项目统一的选择器（对账 #1152：原来那对分段按钮是自己画的，不是项目控件） */}
            <div className={styles.sites} data-workflows-sites>
              <ChoicePicker
                name="workflows-site"
                compact
                alignEnd
                ariaLabel={isComfyUi ? '工作流来源' : 'RunningHub 站点'}
                value={channel.id}
                options={options.map((item) => ({ value: item.id, label: workflowChannelLabel(item) }))}
                onChange={(id) => onChannel(id)}
              />
            </div>
          </div>

          {!hasKey && !isComfyUi ? (
            <div className={styles.banner} data-workflows-no-key {...noticeA11y('info')}>
              <span>
                {workflowChannelLabel(channel)}还没填 API Key —— 导入要用它拉参数，测试运行也要用它。点右边「渠道与 Key」去填。
              </span>
            </div>
          ) : null}

          <div className={styles.toolbar}>
            <input
              className={styles.importInput}
              value={input}
              placeholder={isComfyUi ? '粘贴 ComfyUI prompt graph JSON（支持 {prompt:{…}}）' : tab === 'app' ? '粘贴 /ai-detail/…、/run/ai-app/… 链接或应用 id' : '粘贴 /run/workflow/… 链接或工作流 id'}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && input.trim() && state.ready && !state.busy) void state.importRef(input).then((entry) => entry && setInput(''))
              }}
              data-workflows-import-input
            />
            <button
              type="button"
              className={styles.primary}
              disabled={state.busy || !state.ready || !input.trim()}
              onClick={() => void state.importRef(input).then((entry) => entry && setInput(''))}
              data-workflows-import
            >
              {state.busy ? '导入中…' : '导入'}
            </button>
            <span className={styles.toolbarSpacer} />
            {tab === 'workflow' && !isComfyUi ? (
              <button type="button" className={styles.ghost} disabled={state.busy || !state.ready} onClick={() => void state.openMarket()} data-workflows-market-open>
                从市场导入
              </button>
            ) : null}
            <button type="button" className={styles.ghost} onClick={onOpenSettings} data-workflows-channel-settings>
              渠道与 Key
            </button>
          </div>

          {state.error ? (
            <p className={styles.error} data-workflows-error {...noticeA11y('error')}>
              {state.error}
            </p>
          ) : null}
          {state.notice ? (
            <p className={styles.notice} data-workflows-notice>
              {state.notice}
            </p>
          ) : null}

          <WorkflowEntryGrid
            tab={tab}
            entries={list}
            ready={state.ready}
            market={tab === 'workflow' ? state.market : null}
            busy={state.busy}
            onCloseMarket={state.closeMarket}
            onAddFromMarket={(item) => void state.addFromMarket(item)}
            onOpen={(entry) => onEntry(entry)}
            onRemove={(entry) => {
              if (window.confirm(`删除「${entry.title}」？节点上选着它的会提示条目不存在，需要重新导入。`)) void state.removeEntry(entry)
            }}
          />
        </>
      )}
    </div>
  )
}
