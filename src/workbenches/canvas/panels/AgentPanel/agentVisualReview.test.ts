import { describe, expect, it, vi } from 'vitest'
import { runAgentVisualReview } from './agentVisualReview'
import { chatModelAcceptsImages } from '../../../../domain/shared/capability'

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

  it('同一聊天 route 的 image 能力允许发送目标与参考图 NodeInput', async () => {
    const execute = vi.fn(async (_request: unknown) => ({
      text: JSON.stringify({ verdict: 'pass', summary: '能看清', issues: [], limitations: [] }),
    }))
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1])
    const result = await runAgentVisualReview({
      store: { getSnapshot: () => ({
        projectId: 'p1', edges: [], nodes: [{
          id: 'img-1', title: '主视觉', data: {
            assetHash: 'target', assetMime: 'image/png', naturalSize: { width: 1, height: 1 },
          },
        }],
      }) as never },
      allChannels: [{
        id: 'same-channel', enabled: true, modelMap: { DeepSeek: 'deepseek-upstream' },
        // 站点摘要过时只报 text；真实 route 图片输入不能被它推翻。
        models: [{ id: 'deepseek-upstream', category: 'chat', inputTypes: ['text'] }],
      }] as never,
      modelRoute: { plan: vi.fn() } as never,
      routeExecution: { execute } as never,
      platform: { assets: { read: vi.fn(async () => ({ bytes: png, mime: 'image/png' })) } } as never,
      onRecordWarning: vi.fn(),
    }, {
      sessionId: 's1', operationId: 'op1', reviewModel: '',
      route: {
        channelId: 'same-channel', logicalModel: 'DeepSeek', upstreamModel: 'deepseek-upstream',
        routePlanId: 'plan', candidates: [],
      },
      contextTrace: { assetRefs: [{ hash: 'reference', mime: 'image/png' }], kitVersionRefs: [] },
      runtimeImageInputs: [{ kind: 'asset', nodeId: 'img-1', assetHash: 'target', mime: 'image/png' }],
      review: { nodeIds: ['img-1'] },
    })
    expect(chatModelAcceptsImages({ category: 'chat', inputTypes: ['text', 'image'] })).toBe(true)
    expect(result.ok).toBe(true)
    expect(execute).toHaveBeenCalledOnce()
    expect(execute.mock.calls[0]![0] as object).toMatchObject({
      channelId: 'same-channel', model: 'deepseek-upstream',
      inputs: [
        { assetHash: 'target', mime: 'image/png' },
        { assetHash: 'reference', mime: 'image/png' },
      ],
    })
  })

  it('没有可读目标图片时优先报缺素材，不误报主模型不支持图片', async () => {
    const result = await runAgentVisualReview({
      store: { getSnapshot: () => ({ projectId: 'p1', nodes: [], edges: [] }) as never },
      allChannels: [{ id: 'text-channel', enabled: true, modelMap: {}, models: [{ id: 'text-model', category: 'chat', inputTypes: ['text'] }] }] as never,
      modelRoute: { plan: vi.fn() } as never,
      routeExecution: { execute: vi.fn() } as never,
      platform: { assets: { read: vi.fn() } } as never,
      onRecordWarning: vi.fn(),
    }, {
      sessionId: 's1', operationId: 'op1', reviewModel: '',
      route: { channelId: 'text-channel', logicalModel: 'text-model', upstreamModel: 'text-model', routePlanId: 'p', candidates: [] },
      review: { nodeIds: ['missing'] },
    })
    expect(result.verdict).toBe('unreviewable')
    expect(result.summary).toContain('没有可读取的目标图片')
  })

  it('★★ 独立 reviewModel 目录 text-only 但目标可读：仍发送图片，不由目录拒绝', async () => {
    const execute = vi.fn(async (_request: unknown) => ({
      text: JSON.stringify({ verdict: 'pass', summary: '独立验收成功', issues: [], limitations: [] }),
    }))
    const result = await runAgentVisualReview({
      store: { getSnapshot: () => ({ projectId: 'p1', edges: [], nodes: [{
        id: 'img-1', title: '目标', data: { assetHash: 'target', assetMime: 'image/png', naturalSize: { width: 1, height: 1 } },
      }] }) as never },
      allChannels: [{ id: 'review-channel', enabled: true, modelMap: { Reviewer: 'review-upstream' },
        models: [{ id: 'review-upstream', category: 'chat', inputTypes: ['text'] }] }] as never,
      modelRoute: { plan: vi.fn(async () => ({ ok: true, plan: {
        logicalModel: 'Reviewer', capability: 'chat', strategy: 'priority',
        candidates: [{ channelId: 'review-channel', upstreamModel: 'review-upstream' }],
      } })) } as never,
      routeExecution: { execute } as never,
      platform: { assets: { read: vi.fn(async () => ({ bytes: new Uint8Array([1]), mime: 'image/png' })) } } as never,
      onRecordWarning: vi.fn(),
    }, {
      sessionId: 's1', operationId: 'op1', reviewModel: 'Reviewer',
      route: { channelId: 'main-channel', logicalModel: 'Main', upstreamModel: 'main', routePlanId: 'p', candidates: [] },
      review: { nodeIds: ['img-1'] },
    })
    expect(result.ok).toBe(true)
    expect(execute).toHaveBeenCalledOnce()
    expect(execute.mock.calls[0]![0] as object).toMatchObject({
      channelId: 'review-channel', model: 'review-upstream', inputs: [{ assetHash: 'target', mime: 'image/png' }],
    })
  })
})
