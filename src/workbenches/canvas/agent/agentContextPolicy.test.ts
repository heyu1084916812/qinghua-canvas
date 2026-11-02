import { describe, expect, it } from 'vitest'
import type { GraphSnapshot } from '../../../domain/canvas/model/graph'
import type { NodeSnapshot } from '../../../domain/canvas/model/node'
import {
  classifyAgentRequest,
  imageNodeIdsAmong,
  promptProfileForMode,
  resolveAgentSkillForTurn,
  summaryForAgentRequest,
} from './agentContextPolicy'

function node(
  id: string,
  type: NodeSnapshot['type'],
  data: Record<string, unknown> = {},
): NodeSnapshot {
  return {
    id,
    projectId: 'p',
    type,
    parentId: null,
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    title: id,
    disabled: false,
    data,
  } as NodeSnapshot
}

const noSignals = {
  hasMentionedImage: false,
  hasSelectedNodes: false,
  hasSelectedImage: false,
  hasTaskPlan: false,
}

describe('Agent request classification', () => {
  it('classifies a plain image request as simple_generate', () => {
    expect(classifyAgentRequest({ ...noSignals, text: '生成一张猫咪海报' })).toBe(
      'simple_generate',
    )
    expect(classifyAgentRequest({ ...noSignals, text: '生成一张品牌海报' })).toBe(
      'simple_generate',
    )
  })

  it('classifies a referenced image edit as reference_edit', () => {
    expect(
      classifyAgentRequest({
        ...noSignals,
        text: '把这张图换成 3D 风格',
        hasMentionedImage: true,
      }),
    ).toBe('reference_edit')
  })

  it('uses an image selected on the canvas for an edit request', () => {
    expect(
      classifyAgentRequest({
        ...noSignals,
        text: '优化一下构图',
        hasSelectedNodes: true,
        hasSelectedImage: true,
      }),
    ).toBe('reference_edit')
  })

  it('classifies explicit canvas movement as canvas_operation', () => {
    expect(
      classifyAgentRequest({ ...noSignals, text: '把这些节点移动并排列整齐' }),
    ).toBe('canvas_operation')
  })

  it('★★ 「排列成一排 / 放在空位置」省略名词时仍识别为画布操作', () => {
    expect(
      classifyAgentRequest({ ...noSignals, text: '完成后给我排列成一排' }),
    ).toBe('canvas_operation')
    expect(
      classifyAgentRequest({
        ...noSignals,
        text: '那你帮我把刚刚生成的整理一下，放在空位置去',
      }),
    ).toBe('canvas_operation')
  })

  it('★★ 同一条消息既要生成又要排列时使用完整工具集', () => {
    expect(
      classifyAgentRequest({ ...noSignals, text: '生成 16 张风格图，完成后排列成一排' }),
    ).toBe('complex_plan')
  })

  it('classifies design research separately and keeps it out of canvas scanning', () => {
    expect(
      classifyAgentRequest({
        ...noSignals,
        text: '做一次品牌设计调研，收集 Pinterest 和 Behance 的公开参考',
      }),
    ).toBe('design_research')
    expect(
      classifyAgentRequest({
        ...noSignals,
        text: '帮我收集一些 P 站参考',
      }),
    ).toBe('design_research')
    expect(
      classifyAgentRequest({
        ...noSignals,
        text: '用这张 Pinterest 参考图生成一个改版',
        hasMentionedImage: true,
      }),
    ).toBe('reference_edit')
    expect(promptProfileForMode('design_research')).toBe('light')
    expect(summaryForAgentRequest(
      {
        nodes: [node('unrelated', 'generation', { assetHash: 'hash' })],
        edges: [],
      },
      'design_research',
    )).toEqual({ nodes: [], edges: [] })
  })

  it('uses selected nodes to resolve a short canvas command', () => {
    expect(
      classifyAgentRequest({
        ...noSignals,
        text: '对齐一下',
        hasSelectedNodes: true,
      }),
    ).toBe('canvas_operation')
  })

  it('classifies multi-stage work and active task plans as complex_plan', () => {
    expect(
      classifyAgentRequest({ ...noSignals, text: '先做 logo，然后做品牌视觉和整套物料' }),
    ).toBe('complex_plan')
    expect(classifyAgentRequest({ ...noSignals, text: '继续', hasTaskPlan: true })).toBe(
      'complex_plan',
    )
  })

  it('uses light prompts for simple generation and reference edits', () => {
    expect(promptProfileForMode('simple_generate')).toBe('light')
    expect(promptProfileForMode('reference_edit')).toBe('light')
    expect(promptProfileForMode('canvas_operation')).toBe('full')
    expect(promptProfileForMode('complex_plan')).toBe('full')
  })
})

describe('Agent context summary', () => {
  const graph: GraphSnapshot = {
    projectId: 'p',
    nodes: [
      node('source', 'generation', { assetHash: 'source-hash' }),
      node('style', 'prompt', { text: 'style' }),
      node('edit', 'generation', { assetHash: 'edit-hash' }),
      node('unrelated', 'generation', { assetHash: 'other-hash' }),
      node('video', 'generation', { assetHash: 'video-hash', mode: 'video' }),
    ],
    edges: [
      {
        id: 'e1',
        projectId: 'p',
        source: 'source',
        target: 'edit',
        sourcePort: 'output',
        targetPort: 'input',
      },
      {
        id: 'e2',
        projectId: 'p',
        source: 'style',
        target: 'edit',
        sourcePort: 'output',
        targetPort: 'input',
      },
    ],
  }

  it('does not include canvas nodes for simple_generate', () => {
    expect(summaryForAgentRequest(graph, 'simple_generate')).toEqual({
      nodes: [],
      edges: [],
    })
  })

  it('keeps only the referenced edit node and its necessary upstream', () => {
    const summary = summaryForAgentRequest(graph, 'reference_edit', ['edit'])
    expect(summary.nodes.map((item) => item.id).sort()).toEqual(['edit', 'source', 'style'])
    expect(summary.edges.map((edge) => edge.id).sort()).toEqual(['e1', 'e2'])
  })

  it('keeps the full graph for canvas operations and complex plans', () => {
    expect(summaryForAgentRequest(graph, 'canvas_operation').nodes).toHaveLength(5)
    expect(summaryForAgentRequest(graph, 'complex_plan').nodes).toHaveLength(5)
  })

  it('finds image outputs only among requested node ids', () => {
    expect(
      imageNodeIdsAmong(graph.nodes, ['unrelated', 'style', 'video', 'missing']),
    ).toEqual(['unrelated'])
  })
})

describe('Per-turn skill injection', () => {
  it('does not inject a persisted/default skill without a current skill chip', () => {
    expect(resolveAgentSkillForTurn([], 'skill_default')).toBeUndefined()
  })

  it('uses the skill chip for this turn and ignores a stale session skill', () => {
    expect(resolveAgentSkillForTurn(['skill_current'], 'skill_stale')).toBe(
      'skill_current',
    )
    expect(
      resolveAgentSkillForTurn(['skill_current', 'skill_second'], 'skill_current'),
    ).toBe('skill_current')
  })
})
