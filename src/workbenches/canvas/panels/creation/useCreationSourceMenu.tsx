import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import type { GenerationData } from '../../../../domain/canvas/model/node'
import { sourceSlotOf, type GenerationSource } from '../../../../domain/canvas/model/generationSource'
import type { Channel } from '../../../../domain/project/channel'
import { channelIdForLogical, toLogicalName } from '../../../../domain/project/modelCatalog'
import { openGlobalSettings } from '../../../../state/ui/globalSettings'
import type { PanelEvent, RecipeSnapshot } from '../panelModel'
import { creationSourceState } from './creationSourceState'
import { channelIconFor, SourceModelMenu } from './SourceModelMenu'
import { buildSourceMenu, cliProtocolOf, type SourceFooterAction, type SourceMenuRow } from './sourceMenuModel'
import { useCliPanelSources } from './useCliPanelSources'
import { useOpenWorkflowsPage } from './useOpenWorkflowsPage'
import { findWorkflowSourceRow, runninghubSiteOf, workflowSourceRows, type WorkflowPanelSources } from './workflowPanelSources'

/**
 * 创作面板的「来源」装配（对账 #1133）：把节点数据 + 三份来源（API 模型 / 工作流条目 / 本机 CLI）
 * 接成模型菜单，并给出面板要的几样结论（当前来源、能不能生成、CLI 工具）。
 *
 * 单独成 hook 是为了让 `CreationPanel`（行数预算已满）只多几行：菜单怎么画在
 * `SourceModelMenu`，菜单数据怎么来在 `sourceMenuModel`，当前来源怎么判在 `creationSourceState`。
 */
export interface CreationSourceMenuInput {
  data: GenerationData
  workflowSources: WorkflowPanelSources | null | undefined
  enabled: readonly Channel[]
  allChannels: readonly Channel[]
  globalModelIds: readonly string[]
  wantedCategory: 'image' | 'video' | 'chat'
  /** 模型 chip 的无障碍名（「生图模型」/「视频模型」，与原单列下拉一致） */
  categoryLabel: string
  ownedChannelId: string
  apiLabel: string
  iconForModel: (name: string) => ReactNode | undefined
  recipeFor: (overrides: Partial<GenerationData>) => RecipeSnapshot
  openPicker: string | null
  onTogglePicker: (key: string) => void
  onClosePicker: () => void
  onEvent: (event: PanelEvent) => void
  /** 提示词面板不走来源菜单（只能选对话模型） */
  enabledMenu: boolean
  disabled?: boolean
}

export function useCreationSourceMenu(input: CreationSourceMenuInput) {
  const { data, workflowSources, enabled, allChannels, onEvent } = input
  const open = input.openPicker === 'model'
  const openWorkflows = useOpenWorkflowsPage()
  const apiLabelOf = (model: string) => toLogicalName(allChannels, model)
  const peek = creationSourceState({ data, workflowSources, channels: allChannels, cli: null, wantedCategory: input.wantedCategory, apiLabelOf })
  const cli = useCliPanelSources(input.enabledMenu && (open || peek.source === 'cli'))
  const state = creationSourceState({ data, workflowSources, channels: allChannels, cli, wantedCategory: input.wantedCategory, apiLabelOf, apiDefault: input.apiLabel })

  /** 老节点补写来源：每个节点只发一次（判得准时，见 `creationSourceState.adopt`） */
  const adopted = useRef<string>('')
  const adoptKey = `${data.model}|${data.channelId}|${state.adopt ?? ''}`
  useEffect(() => {
    if (!input.enabledMenu || !state.adopt || adopted.current === adoptKey) return
    adopted.current = adoptKey
    onEvent({ type: 'adoptSource', source: state.adopt })
  }, [adoptKey, input.enabledMenu, state.adopt, onEvent])

  const rows = workflowSourceRows(workflowSources)
  const siteOf = (channelId: string) => runninghubSiteOf(workflowSources?.channels.find((channel) => channel.id === channelId)?.baseUrl)
  const tabs = useMemo(
    () =>
      buildSourceMenu({
        apiModels: input.globalModelIds.map((name) => {
          const channelId = channelIdForLogical(enabled, name) ?? ''
          return { name, channelId, channelName: enabled.find((channel) => channel.id === channelId)?.name ?? '' }
        }),
        workflowRows: rows,
        siteOf,
        cli,
        wantedCategory: input.wantedCategory,
        currentModel: data.model ?? '',
        currentInstance: data.workflowInstance === 'plus' ? 'plus' : 'default',
      }),
    /* rows / siteOf 由 workflowSources 派生，不单列依赖 */
    [input.globalModelIds, enabled, workflowSources, cli, input.wantedCategory, data.model, data.workflowInstance],
  )

  const pick = (row: SourceMenuRow) => {
    if (row.pick.source !== 'api') {
      onEvent({ type: 'selectSource', pick: row.pick, from: state.source })
      return
    }
    /** API：按逻辑名重新选路（优先节点原渠道），配方按切回后的 API 参数记 */
    const provider = channelIdForLogical(enabled, row.pick.model, input.ownedChannelId) ?? input.ownedChannelId
    const restored = state.source === 'api' ? {} : (sourceSlotOf(data, 'api')?.params ?? {})
    onEvent({
      type: 'selectSource',
      pick: { ...row.pick, channelId: provider },
      from: state.source,
      recipe: { ...input.recipeFor({ ...restored, source: 'api', model: row.pick.model }), channelId: provider, model: row.pick.model },
    })
  }
  const current = state.source === 'workflow' ? findWorkflowSourceRow(workflowSources, data.model, data.channelId) : null
  /** 「管理…」落在当前条目上（#1131 口径）；不在工作流来源时打开管理页首页 */
  const footer = (action: SourceFooterAction) => {
    if (action === 'channels') onEvent({ type: 'openSettings' })
    else if (action === 'workflows')
      openWorkflows(current ? { channelId: current.channelId, tab: current.entry.kind === 'app' ? 'app' : 'workflow', entryId: current.entry.id } : {})
    else openGlobalSettings('cli')
  }
  const label =
    state.source === 'api'
      ? input.apiLabel
      : state.source === 'workflow'
        ? (current?.entry.title ?? '条目不存在')
        : (state.cliTool?.tool.name ?? state.cliToolId ?? '本机 CLI')
  const icon =
    state.source === 'api'
      ? input.iconForModel(input.apiLabel)
      : state.source === 'workflow'
        ? channelIconFor(current?.protocol ?? 'runninghub-api')
        : channelIconFor(cliProtocolOf(state.cliToolId ?? ''))

  const picker = input.enabledMenu ? (
    <SourceModelMenu
      tabs={tabs}
      ariaLabel={input.categoryLabel}
      source={state.source}
      selected={state.selected}
      label={label}
      icon={icon}
      iconFor={(item) => (item.kind === 'model' ? input.iconForModel(item.name) : channelIconFor(item.protocol))}
      open={open}
      onToggle={() => input.onTogglePicker('model')}
      onClose={input.onClosePicker}
      onPick={pick}
      onFooter={footer}
      disabled={input.disabled}
    />
  ) : null

  const source: GenerationSource = input.enabledMenu ? state.source : 'api'
  return {
    source,
    picker,
    cliTool: state.cliTool,
    blockedReason: input.enabledMenu ? state.blockedReason : null,
    openCliSettings: () => openGlobalSettings('cli'),
  }
}
