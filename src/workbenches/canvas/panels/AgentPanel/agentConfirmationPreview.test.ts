import { describe, expect, it } from 'vitest'
import type { CanvasStore } from '../../../../state/workbenches/canvas/store'
import { previewOf } from './agentConfirmationPreview'

function storeOf(input: {
  nodes?: {
    id: string
    title?: string
    type?: string
    disabled?: boolean
    data?: object
  }[]
  edges?: { id: string; source: string; target: string }[]
}): Pick<CanvasStore, 'getSnapshot'> {
  return {
    getSnapshot: () =>
      ({
        nodes: input.nodes ?? [],
        edges: input.edges ?? [],
      }) as ReturnType<CanvasStore['getSnapshot']>,
  }
}

describe('previewOf', () => {
  it('把需要付费运行的节点名说清楚', () => {
    const preview = previewOf(
      {
        kind: 'awaitingConfirm',
        request: {
          callId: 'call-1',
          name: 'runNode',
          args: { nodeIds: ['node-1'] },
        },
      },
      storeOf({
        nodes: [{ id: 'node-1', title: '主图', type: 'generation', data: {} }],
      }),
    )

    expect(preview?.title).toContain('主图')
    expect(preview?.lines).toContain('跑 1 个节点（会花钱）')
    expect(preview?.action).toBe('批准运行')
  })

  it('★ A6：多节点时标题列出全部节点，并逐个写明渠道名与模型名', () => {
    const channels = [
      {
        id: 'xssr',
        name: 'XSSR 生图站',
        enabled: true,
        models: [{ id: 'gpt-image-2.5', category: 'image' as const, inputTypes: ['text' as const] }],
        modelCache: [],
        modelMap: {},
      },
      {
        id: 'off',
        name: '停用站',
        enabled: false,
        models: [{ id: 'gpt-image-2.5', category: 'image' as const, inputTypes: ['text' as const] }],
        modelCache: [],
        modelMap: {},
      },
    ]
    const preview = previewOf(
      {
        kind: 'awaitingConfirm',
        request: { callId: 'c', name: 'runNode', args: { nodeIds: ['a', 'b', 'c'] } },
      },
      storeOf({
        nodes: [
          { id: 'a', title: '山野｜Logo 标识', type: 'generation', data: { model: 'gpt-image-2.5', channelId: 'off' } },
          { id: 'b', title: '山野｜产品包装', type: 'generation', data: { model: 'gpt-image-2.5', channelId: 'xssr' } },
          { id: 'c', title: '山野｜社媒海报', type: 'generation', data: { model: '' } },
        ],
      }),
      channels,
    )
    expect(preview?.title).toBe('是否运行节点「山野｜Logo 标识」「山野｜产品包装」「山野｜社媒海报」生成图片？')
    expect(preview?.lines).toEqual([
      '「山野｜Logo 标识」：渠道 XSSR 生图站 · 模型 gpt-image-2.5',
      '「山野｜产品包装」：渠道 XSSR 生图站 · 模型 gpt-image-2.5',
      '「山野｜社媒海报」：渠道 未找到可用渠道 · 模型 未选择',
      '跑 3 个节点（会花钱）',
    ])
  })

  it('删除节点时列出名字和素材库不受影响的边界', () => {
    const preview = previewOf(
      {
        kind: 'awaitingConfirm',
        request: {
          callId: 'call-2',
          name: 'deleteNodes',
          args: { nodeIds: ['node-1', 'node-2'] },
        },
      },
      storeOf({
        nodes: [
          { id: 'node-1', title: '封面', type: 'generation', data: {} },
          { id: 'node-2', title: '标题', type: 'prompt', data: {} },
        ],
      }),
    )

    expect(preview?.title).toBe('要删除 2 个节点？')
    expect(preview?.lines).toEqual([
      '封面',
      '标题',
      '关联连线会一并删除，素材库里的图片文件不受影响。',
    ])
  })

  it('没有待确认状态时不生成卡片', () => {
    expect(previewOf({ kind: 'idle' }, storeOf({}))).toBeNull()
  })

  /**
   * #934-B：这条是"花钱前那张清单"的自相矛盾点。
   *
   * 起点不存在时必须说「不能运行」，**不能**同时说「会花钱」——否则用户会以为自己
   * 批准的是一个能跑、要付钱的方案（实际上是坏链），点完只会拿到一条错误。
   */
  it('★ runFrom 起点不存在：只说"不能运行"，不许同时说"会花钱"', () => {
    const preview = previewOf(
      {
        kind: 'awaitingConfirm',
        request: {
          callId: 'call-3',
          name: 'runFrom',
          args: { nodeIds: ['missing-node'] },
        },
      },
      storeOf({ nodes: [], edges: [] }),
    )

    expect(preview?.title).toBe('这条下游链不能运行')
    expect(preview?.lines).toEqual(['找不到起点节点：missing-node'])
    expect(preview?.lines.join('\n')).not.toContain('会花钱')
    expect(preview?.action).toBe('知道了')
  })

  /**
   * #934-B：`edgeIds` 与 `pairs` 指向同一条连线时只算一次。
   *
   * 算重了会让确认卡写「要取消 3 条连线？」——用户看到的数字和实际不符，
   * 这正是"误批准"的来源。
   */
  it('★★ deleteEdges：ids 与 pairs 命中同一条线只算一次', () => {
    const preview = previewOf(
      {
        kind: 'awaitingConfirm',
        request: {
          callId: 'call-4',
          name: 'deleteEdges',
          args: {
            // e1 同时被 id 和 pair 命中（a→b），e2 只被 pair 命中
            edgeIds: ['e1', 'e1'],
            pairs: [
              { source: 'a', target: 'b' },
              { source: 'b', target: 'c' },
              { source: 'not-an-edge', target: 'nope' },
              'not-a-pair',
            ],
          },
        },
      },
      storeOf({
        nodes: [
          { id: 'a', title: 'A' },
          { id: 'b', title: 'B' },
          { id: 'c', title: 'C' },
        ],
        edges: [
          { id: 'e1', source: 'a', target: 'b' },
          { id: 'e2', source: 'b', target: 'c' },
          { id: 'e3', source: 'c', target: 'a' },
        ],
      }),
    )

    expect(preview?.title).toBe('要取消 2 条连线？')
    expect(preview?.lines).toEqual(['A → B', 'B → C'])
    expect(preview?.action).toBe('取消这些连线')
  })
})
