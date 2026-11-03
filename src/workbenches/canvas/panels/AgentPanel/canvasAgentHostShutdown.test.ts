import { afterEach, describe, expect, it } from 'vitest'
import {
  getAgentHosts,
  invalidateAgentHostsForHmr,
  resetAgentHostsForTests,
  upsertAgentHost,
} from '../../../../app/AgentHostRegistry'
import {
  prepareProjectRuntimes,
  registerProjectRuntime,
  resetProjectRuntimesForTests,
} from '../../../../app/ProjectRuntimeRegistry'
import { createCanvasAgentHostShutdownControl } from './canvasAgentHostShutdown'

afterEach(() => {
  resetProjectRuntimesForTests()
  resetAgentHostsForTests()
})

describe('Canvas AgentHost shutdown generation', () => {
  it('prepare 中重挂载不产生新 generation，commit 后无残留 host', async () => {
    const host = upsertAgentHost({
      id: 'canvas-agent:p1',
      kind: 'canvas-agent',
      payload: { revision: 1 },
      active: true,
    })
    registerProjectRuntime({
      projectId: 'p1',
      key: 'canvas-agent',
      beginDispose: () =>
        createCanvasAgentHostShutdownControl({
          projectId: 'p1',
          hostId: host.id,
          generation: host.generation,
        }),
    })
    const disposal = await prepareProjectRuntimes(['p1'])

    invalidateAgentHostsForHmr('canvas-agent')
    const remounted = upsertAgentHost({
      id: host.id,
      kind: 'canvas-agent',
      payload: { revision: 2 },
      active: true,
    })
    expect(remounted.generation).toBe(host.generation)

    await expect(disposal.commit()).resolves.toEqual({
      status: 'cleanup_complete',
    })
    expect(getAgentHosts()).toEqual([])
  })

  it('rollback 释放冻结，后续 HMR 可建立新 generation', async () => {
    const host = upsertAgentHost({
      id: 'canvas-agent:p2',
      kind: 'canvas-agent',
      payload: { revision: 1 },
      active: true,
    })
    registerProjectRuntime({
      projectId: 'p2',
      key: 'canvas-agent',
      beginDispose: () =>
        createCanvasAgentHostShutdownControl({
          projectId: 'p2',
          hostId: host.id,
          generation: host.generation,
        }),
    })
    const disposal = await prepareProjectRuntimes(['p2'])

    await expect(disposal.rollback()).toEqual({
      status: 'rolled_back',
    })
    invalidateAgentHostsForHmr('canvas-agent')
    const remounted = upsertAgentHost({
      id: host.id,
      kind: 'canvas-agent',
      payload: { revision: 2 },
      active: true,
    })
    expect(remounted.generation).not.toBe(host.generation)
  })

  it('部分 finalize 失败后重挂载也不会在冻结代际上留下新 host', async () => {
    const host = upsertAgentHost({
      id: 'canvas-agent:p3',
      kind: 'canvas-agent',
      payload: { revision: 1 },
      active: true,
    })
    registerProjectRuntime({
      projectId: 'p3',
      key: 'canvas-agent',
      beginDispose: () =>
        createCanvasAgentHostShutdownControl({
          projectId: 'p3',
          hostId: host.id,
          generation: host.generation,
        }),
    })
    let finalizeAttempts = 0
    registerProjectRuntime({
      projectId: 'p3',
      key: 'late-failure',
      beginDispose: () => ({
        waitForIdle: async () => undefined,
        whenIdle: async () => undefined,
        canReopen: () => true,
        reopenIfIdle: () => true,
        canFinalize: () => true,
        finalize() {
          finalizeAttempts += 1
          return finalizeAttempts > 1
        },
      }),
    })
    const disposal = await prepareProjectRuntimes(['p3'])

    await expect(disposal.commit()).resolves.toMatchObject({
      status: 'cleanup_failed',
    })
    invalidateAgentHostsForHmr('canvas-agent')
    upsertAgentHost({
      id: host.id,
      kind: 'canvas-agent',
      payload: { revision: 2 },
      active: true,
    })
    expect(getAgentHosts()).toEqual([])

    await expect(disposal.commit()).resolves.toEqual({
      status: 'cleanup_complete',
    })
    expect(getAgentHosts()).toEqual([])
  })
})
