import type { GenerationData } from '../../../../domain/canvas/model/node'
import {
  isGenerationSource,
  nodeSource,
  sourceSlotOf,
  toolIdOfCliModel,
  type GenerationSource,
  type SourceInferenceContext,
} from '../../../../domain/canvas/model/generationSource'
import { capabilityLabel, CLI_PROTOCOL_TOOL, type CliCapability } from '../../../../domain/shared/cliTools'
import type { CliPanelSources, CliPanelTool } from './sourceMenuModel'
import { findWorkflowSourceRow, type WorkflowPanelSources } from './workflowPanelSources'

/**
 * 创作面板「当前来源」的纯决策（对账 #1133）：节点归哪个来源、每个标签该勾哪一行、
 * 老节点要不要补写来源、这个来源现在能不能生成（不能就给一句原因，按钮置灰）。
 */
export interface CreationSourceInput {
  data: GenerationData
  workflowSources: WorkflowPanelSources | null | undefined
  /** 全部渠道（判老节点是不是挂在本机 CLI 协议的渠道上）；空 = 渠道店还没读完 */
  channels: readonly { id: string; protocol: string }[]
  cli: CliPanelSources | null
  wantedCategory: CliCapability
  /** API 模型 id → 菜单里那一行的显示名（老数据可能存的是上游 id） */
  apiLabelOf: (model: string) => string
}

export interface CreationSourceState {
  source: GenerationSource
  /** 老节点（没存来源）且判得准时，要写回节点的来源；不需要 / 判不准为 null */
  adopt: GenerationSource | null
  /** 每个来源上次选的那一行（菜单打勾） */
  selected: Partial<Record<GenerationSource, string>>
  cliToolId: string | null
  cliTool: CliPanelTool | null
  blockedReason: string | null
}

function inferenceContext(input: CreationSourceInput): SourceInferenceContext {
  const cliChannels = new Set(input.channels.filter((channel) => channel.protocol in CLI_PROTOCOL_TOOL).map((channel) => channel.id))
  return {
    isEntryModel: (model, channelId) => findWorkflowSourceRow(input.workflowSources, model, channelId) !== null,
    isCliChannel: (channelId) => cliChannels.has(channelId),
  }
}

/** CLI 来源用的是哪个工具：新数据看 `cli:<tool>`，老数据看渠道协议 */
export function cliToolIdOf(
  data: Pick<GenerationData, 'model' | 'channelId'>,
  channels: readonly { id: string; protocol: string }[],
): string | null {
  const direct = toolIdOfCliModel(data.model)
  if (direct) return direct
  const protocol = channels.find((channel) => channel.id === data.channelId)?.protocol ?? ''
  return CLI_PROTOCOL_TOOL[protocol] ?? null
}

/**
 * 老节点补写来源只在**判得准**时做：渠道店读完了（否则 CLI 渠道判不出）；
 * `app:` 还要等条目读完（否则导入过的应用会被误判成 API 并写死）。
 */
function adoptable(input: CreationSourceInput): boolean {
  if (isGenerationSource(input.data.source) || !input.data.model) return false
  if (input.channels.length === 0) return false
  if (input.data.model.startsWith('app:')) return input.workflowSources?.loaded === true
  return true
}

export function creationSourceState(input: CreationSourceInput): CreationSourceState {
  const { data } = input
  const context = inferenceContext(input)
  const source = nodeSource(data, context)
  const selected: Partial<Record<GenerationSource, string>> = {}
  const api = sourceSlotOf(data, 'api', context)
  if (api) selected.api = `api::${input.apiLabelOf(api.model)}`
  const flow = sourceSlotOf(data, 'workflow', context)
  if (flow) selected.workflow = `${flow.channelId}::${flow.model}`
  const cliSlot = sourceSlotOf(data, 'cli', context)
  const slotTool = cliSlot ? cliToolIdOf(cliSlot, input.channels) : null
  if (slotTool) selected.cli = `cli::${slotTool}`
  const cliToolId = source === 'cli' ? cliToolIdOf(data, input.channels) : null
  const cliTool = cliToolId ? (input.cli?.tools.find((item) => item.tool.id === cliToolId) ?? null) : null
  return {
    source,
    adopt: adoptable(input) ? source : null,
    selected,
    cliToolId,
    cliTool,
    blockedReason: blockedReasonOf(input, source, cliToolId, cliTool),
  }
}

function blockedReasonOf(
  input: CreationSourceInput,
  source: GenerationSource,
  toolId: string | null,
  tool: CliPanelTool | null,
): string | null {
  if (source === 'workflow') {
    /** 条目还没读完不拦（否则一打开就闪「已被删除」）；执行端找不到条目仍会报错 */
    if (!input.workflowSources || input.workflowSources.loaded === false) return null
    return findWorkflowSourceRow(input.workflowSources, input.data.model, input.data.channelId)
      ? null
      : '这个条目已被删除或不在当前渠道，换一个条目再生成'
  }
  if (source !== 'cli') return null
  if (!input.cli) return null
  if (!input.cli.desktop) return '本机 CLI 需要桌面版：网页版不能运行，请换 API / 工作流来源'
  if (!tool) return `找不到本机 CLI 工具「${toolId ?? ''}」，换一个工具再生成`
  if (!tool.tool.models.some((model) => model.category === input.wantedCategory)) {
    return `「${tool.tool.name}」不能${capabilityLabel(input.wantedCategory)}，换一个工具或换回 API`
  }
  if (tool.status === 'missing') return `本机未检测到「${tool.tool.name}」的命令「${tool.tool.program}」，去本机 CLI 设置装好再生成`
  return null
}
