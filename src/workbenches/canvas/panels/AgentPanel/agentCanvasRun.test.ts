import { describe, expect, it, vi } from 'vitest'
import type { CanvasStore } from '../../../../state/workbenches/canvas/store'
import type { ChannelStore } from '../../../../state/channel/channelStore'
import type { PlatformKit } from '../../../../platform/ports'
import { ChannelError } from '../../../../platform/channels/types'
import {
  agentCanvasFailureText,
  runAgentCanvasNodes,
} from './agentCanvasRun'

const graph = {
  projectId: 'project-1',
  nodes: [],
  edges: [],
} as unknown as ReturnType<CanvasStore['getSnapshot']>

describe('runAgentCanvasNodes', () => {
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
})
