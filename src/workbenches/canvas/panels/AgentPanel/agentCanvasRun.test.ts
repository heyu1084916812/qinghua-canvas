import { describe, expect, it, vi } from 'vitest'
import type { CanvasStore } from '../../../../state/workbenches/canvas/store'
import type { ChannelStore } from '../../../../state/channel/channelStore'
import type { PlatformKit } from '../../../../platform/ports'
import { runAgentCanvasNodes } from './agentCanvasRun'

const graph = {
  projectId: 'project-1',
  nodes: [],
  edges: [],
} as unknown as ReturnType<CanvasStore['getSnapshot']>

describe('runAgentCanvasNodes', () => {
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
    expect(setRunTasksFor).toHaveBeenCalled()
  })
})
