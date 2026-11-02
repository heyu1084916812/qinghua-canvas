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
})
