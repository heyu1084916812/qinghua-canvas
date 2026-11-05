/** 面板两档高度与运行按钮状态：和渲染树分离的纯决策。 */
import type { GenerationData } from '../../../../domain/canvas/model/node'

export interface CreationPanelGeometry {
  promptExpanded: boolean
  runLabel: string
  blockedReason: string | null
  runDisabled: boolean
  runTitle: string
  platformGap: string
}

export function panelGeometryFor(input: {
  data: GenerationData
  nodeId: string
  expandedNodeId: string | null
  promptMode: boolean
  runsDownstream: boolean
  running: boolean
  disabled: boolean
  enabledChannelCount: number
  allChannelCount: number
}): CreationPanelGeometry {
  const {
    data,
    nodeId,
    expandedNodeId,
    promptMode,
    runsDownstream,
    running,
    disabled,
    enabledChannelCount,
    allChannelCount,
  } = input
  const promptExpanded = nodeId !== '' && expandedNodeId === nodeId
  const runLabel = running
    ? '取消当前生成'
    : promptMode || runsDownstream
      ? '生成下游节点'
      : '生成当前节点'
  const platformGap =
    allChannelCount === 0 ? '还没有添加任何模型服务' : '已添加的模型服务都未启用'
  const blockedReason = running
    ? null
    : disabled
      ? '节点已禁用'
      : enabledChannelCount === 0
        ? platformGap
        : null
  const runDisabled = blockedReason !== null
  const runTitle = disabled
    ? '节点已禁用 —— 先启用再生成；它的内容（含已生成的图）不会作为上游输入'
    : blockedReason
      ? `${blockedReason}，去后台设置后再生成`
      : runLabel
  void data
  return { promptExpanded, runLabel, blockedReason, runDisabled, runTitle, platformGap }
}
