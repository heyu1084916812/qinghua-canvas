import { describe, expect, it } from 'vitest'
import type { GenerationData } from '../../../../domain/canvas/model/node'
import { panelGeometryFor } from './creationPanelGeometry'

const data = { mode: 'image' } as GenerationData
const base = {
  data,
  nodeId: 'n1',
  expandedNodeId: null as string | null,
  promptMode: false,
  runsDownstream: false,
  running: false,
  disabled: false,
  enabledChannelCount: 1,
  allChannelCount: 1,
}

describe('CreationPanel 两档高度与生成状态', () => {
  it('展开态只认当前节点，切换节点不串味', () => {
    expect(panelGeometryFor({ ...base, expandedNodeId: 'n1' }).promptExpanded).toBe(true)
    expect(panelGeometryFor({ ...base, expandedNodeId: 'n2' }).promptExpanded).toBe(false)
    expect(panelGeometryFor({ ...base, nodeId: '', expandedNodeId: '' }).promptExpanded).toBe(false)
  })

  it('提示词与下游分发器都明确写生成下游节点', () => {
    expect(panelGeometryFor({ ...base, promptMode: true }).runLabel).toBe('生成下游节点')
    expect(panelGeometryFor({ ...base, runsDownstream: true }).runLabel).toBe('生成下游节点')
    expect(panelGeometryFor(base).runLabel).toBe('生成当前节点')
    expect(panelGeometryFor({ ...base, running: true }).runLabel).toBe('取消当前生成')
  })

  it('无可用渠道与节点禁用都先于点击说明原因，运行中不重复禁用', () => {
    const noChannel = panelGeometryFor({ ...base, enabledChannelCount: 0, allChannelCount: 0 })
    expect(noChannel.platformGap).toBe('还没有添加任何模型服务')
    expect(noChannel.runDisabled).toBe(true)
    expect(noChannel.runTitle).toContain('去后台设置')
    expect(panelGeometryFor({ ...base, enabledChannelCount: 0, allChannelCount: 2 }).platformGap).toBe(
      '已添加的模型服务都未启用',
    )
    expect(panelGeometryFor({ ...base, disabled: true }).blockedReason).toBe('节点已禁用')
    expect(panelGeometryFor({ ...base, running: true, enabledChannelCount: 0 }).runDisabled).toBe(false)
  })
})
