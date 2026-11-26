import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasStore } from '../../../../state/workbenches/canvas/store'
import type { ChannelStore } from '../../../../state/channel/channelStore'
import type { PlatformKit } from '../../../../platform/ports'
import { ChannelError } from '../../../../platform/channels/types'
import { CanvasRunPreflightError } from '../../execution/canvasRunPreflight'
import { runPreflightProblems } from '../../agent/runPreflight'
import {
  agentCanvasFailureText,
  runAgentCanvasNodes,
} from './agentCanvasRun'

vi.mock('../../agent/runPreflight', () => ({
  runPreflightProblems: vi.fn(),
}))

const mockedPreflight = vi.mocked(runPreflightProblems)

const graph = {
  projectId: 'project-1',
  nodes: [],
  edges: [],
} as unknown as ReturnType<CanvasStore['getSnapshot']>

describe('runAgentCanvasNodes', () => {
  beforeEach(() => {
    mockedPreflight.mockReset()
    mockedPreflight.mockReturnValue([])
  })

  it('渠道错误保留真实 HTTP 原因，不泄漏调试串', () => {
    const text = agentCanvasFailureText(
      new ChannelError({
        kind: 'http',
        status: 502,
        body: '{"error":{"message":"上游模型暂不可用"}}',
      }),
    )
    expect(text).toContain('HTTP 502')
    expect(text).toContain('上游模型暂不可用')
    expect(text).not.toContain('[channel] http')
  })

  it('执行前 preflight 失败时不发付费请求，并把失败写回任务行', async () => {
    mockedPreflight.mockReturnValue([
      '节点不存在：node-missing',
    ])
    const setRunTasksFor = vi.fn()
    const runNode = vi.fn(async () => undefined)
    const flush = vi.fn(async () => undefined)
    const store = {
      getSnapshot: () => graph,
      flush,
    } as unknown as CanvasStore
    const channels = {
      getState: () => ({ channels: [] }),
      protocolCatalog: () => ({}),
    } as unknown as ChannelStore
    const platform = {
      storage: {
        query: vi.fn(async () => []),
      },
    } as unknown as PlatformKit

    const outcomes = await runAgentCanvasNodes(
      {
        store,
        execution: { runNode },
        channels,
        platform,
        contextAssets: [],
        setRunTasksFor,
      },
      {
        sessionId: 'session-1',
        nodeIds: ['node-missing'],
      },
    )

    expect(runNode).not.toHaveBeenCalled()
    expect(flush).toHaveBeenCalledTimes(1)
    expect(outcomes).toHaveLength(1)
    expect(outcomes[0]).toMatchObject({
      nodeId: 'node-missing',
      ok: false,
    })
    /**
     * #930：钉住会话 id —— 写错会话的进度条正是这类断言要抓的。
     * 无参数的 `toHaveBeenCalled()` 连"第一次写错会话"都会绿，所以这里查**每一次**调用。
     */
    const taskTargets = setRunTasksFor.mock.calls.map((call) => call[0])
    expect(taskTargets.length).toBeGreaterThan(0)
    expect(new Set(taskTargets)).toEqual(new Set(['session-1']))
    expect(setRunTasksFor).toHaveBeenNthCalledWith(
      1,
      'session-1',
      expect.arrayContaining([
        expect.objectContaining({ nodeId: 'node-missing' }),
      ]),
    )
  })

  it('执行计划返回承载节点后按真实落点对账', async () => {
    const runNode = vi.fn(async () => ({
      ok: true as const,
      planId: 'plan-1',
      executedNodeIds: ['carrier-node'],
    }))
    const store = {
      getSnapshot: () => graph,
      flush: vi.fn(async () => undefined),
    } as unknown as CanvasStore
    const channels = {
      getState: () => ({ channels: [] }),
      protocolCatalog: () => ({}),
    } as unknown as ChannelStore
    const platform = {
      storage: {
        query: vi
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValue([
            {
              id: 'run-carrier',
              nodeId: 'carrier-node',
              projectId: 'project-1',
              version: 1,
              createdAt: 2,
              status: 'succeeded',
              inputs: [],
              params: {},
              outputHashes: ['hash'],
              fingerprint: 'fp',
              taskId: 'task',
              durationMs: 1,
              sentChannelId: 'ch-a',
              sentModel: 'gpt-image-2.6',
            },
          ]),
      },
    } as unknown as PlatformKit

    const outcomes = await runAgentCanvasNodes(
      {
        store,
        execution: { runNode },
        channels,
        platform,
        contextAssets: [],
        setRunTasksFor: vi.fn(),
      },
      { sessionId: 'session-1', nodeIds: ['source-node'] },
    )

    expect(outcomes[0]).toMatchObject({
      nodeId: 'source-node',
      targetNodeIds: ['source-node', 'carrier-node'],
      ok: true,
      channelId: 'ch-a',
      model: 'gpt-image-2.6',
    })
  })

  it('付费执行未知异常继续抛出，交给持久账本转 needs_attention', async () => {
    const runNode = vi.fn(async () => {
      throw new Error('图已提交后 flush 失败')
    })
    const store = {
      getSnapshot: () => graph,
      flush: vi.fn(async () => undefined),
    } as unknown as CanvasStore
    const channels = {
      getState: () => ({ channels: [] }),
      protocolCatalog: () => ({}),
    } as unknown as ChannelStore
    const platform = {
      storage: { query: vi.fn(async () => []) },
    } as unknown as PlatformKit

    await expect(
      runAgentCanvasNodes(
        {
          store,
          execution: { runNode },
          channels,
          platform,
          contextAssets: [],
          setRunTasksFor: vi.fn(),
        },
        { sessionId: 'session-1', nodeIds: ['source-node'] },
      ),
    ).rejects.toThrow('图已提交后 flush 失败')
  })

  it('确定的预检异常仍作为普通失败回填', async () => {
    const runNode = vi.fn(async () => {
      throw new CanvasRunPreflightError([])
    })
    const store = {
      getSnapshot: () => graph,
      flush: vi.fn(async () => undefined),
    } as unknown as CanvasStore
    const channels = {
      getState: () => ({ channels: [] }),
      protocolCatalog: () => ({}),
    } as unknown as ChannelStore
    const platform = {
      storage: { query: vi.fn(async () => []) },
    } as unknown as PlatformKit

    const outcomes = await runAgentCanvasNodes(
      {
        store,
        execution: { runNode },
        channels,
        platform,
        contextAssets: [],
        setRunTasksFor: vi.fn(),
      },
      { sessionId: 'session-1', nodeIds: ['source-node'] },
    )
    expect(outcomes[0]).toMatchObject({ nodeId: 'source-node', ok: false })
  })
})
