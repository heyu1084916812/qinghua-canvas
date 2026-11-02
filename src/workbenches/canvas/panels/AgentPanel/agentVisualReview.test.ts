import { describe, expect, it, vi } from 'vitest'
import { runAgentVisualReview } from './agentVisualReview'

describe('runAgentVisualReview', () => {
  it('没有对话路由时明确返回不可验收，不伪造通过', async () => {
    const result = await runAgentVisualReview(
      {
        store: {
          getSnapshot: () =>
            ({
              projectId: 'project-1',
              nodes: [],
              edges: [],
            }) as never,
        },
        allChannels: [],
        modelRoute: {
          plan: vi.fn(),
        } as never,
        routeExecution: {
          execute: vi.fn(),
        } as never,
        platform: {
          assets: {
            read: vi.fn(),
          },
        } as never,
        onRecordWarning: vi.fn(),
      },
      {
        sessionId: 'session-1',
        operationId: 'op-1',
        route: null,
        reviewModel: '',
        review: {
          nodeIds: ['local-1', 'node-2'],
        },
      },
    )

    expect(result.ok).toBe(false)
    expect(result.verdict).toBe('unreviewable')
    expect(result.targetNodeIds).toEqual(['local-1', 'node-2'])
    expect(result.summary).toContain('没有可用的视觉验收模型路由')
  })

  it('别名先解析成真实节点 id 再限制快速验收上限', async () => {
    const result = await runAgentVisualReview(
      {
        store: {
          getSnapshot: () =>
            ({
              projectId: 'project-1',
              nodes: [],
              edges: [],
            }) as never,
        },
        allChannels: [],
        modelRoute: {
          plan: vi.fn(),
        } as never,
        routeExecution: {
          execute: vi.fn(),
        } as never,
        platform: {
          assets: {
            read: vi.fn(),
          },
        } as never,
        onRecordWarning: vi.fn(),
      },
      {
        sessionId: 'session-1',
        operationId: 'op-1',
        route: null,
        reviewModel: '',
        aliases: new Map([
          ['local-1', 'node-real-1'],
          ['local-2', 'node-real-2'],
        ]),
        review: {
          nodeIds: ['local-1', 'local-2', 'node-3', 'node-4', 'node-5'],
        },
      },
    )

    expect(result.targetNodeIds).toEqual([
      'node-real-1',
      'node-real-2',
      'node-3',
      'node-4',
    ])
    expect(result.limitations[0]).toContain('另有 1 张未提交')
  })
})
