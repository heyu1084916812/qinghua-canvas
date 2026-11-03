import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getAgentHosts,
  resetAgentHostsForTests,
  setAgentHostDisposer,
  upsertAgentHost,
} from '../../../../app/AgentHostRegistry'
import {
  prepareProjectRuntimes,
  registerProjectRuntime,
  resetProjectRuntimesForTests,
} from '../../../../app/ProjectRuntimeRegistry'
import type { TaskShutdownControl } from '../../../../features/shared/lifecycle/taskLifecycle'

const executionRuntime = vi.hoisted(() => ({
  beginShutdown: vi.fn(),
}))

vi.mock('../../execution/canvasExecutionRuntime', () => ({
  beginCanvasExecutionRuntimeShutdown:
    executionRuntime.beginShutdown,
}))

import { createCanvasAgentHostShutdownControl } from './canvasAgentHostShutdown'

afterEach(() => {
  resetProjectRuntimesForTests()
  resetAgentHostsForTests()
  executionRuntime.beginShutdown.mockReset()
})

function childControl(
  finalize: () => boolean,
): TaskShutdownControl {
  let finalized = false
  return {
    waitForIdle: async () => undefined,
    whenIdle: async () => undefined,
    canReopen: () => !finalized,
    reopenIfIdle: () => !finalized,
    canFinalize: () => !finalized,
    finalize() {
      if (finalized) return true
      const result = finalize()
      finalized = result
      return result
    },
  }
}

async function prepareCombined(
  finalize: () => boolean,
) {
  const host = upsertAgentHost({
    id: 'canvas-agent:combined',
    kind: 'canvas-agent',
    payload: {},
    active: true,
  })
  const hostFinalize = vi.fn(() => true)
  setAgentHostDisposer(
    host.id,
    () => childControl(hostFinalize),
    host.generation,
  )
  executionRuntime.beginShutdown.mockReturnValue(
    childControl(finalize),
  )
  registerProjectRuntime({
    projectId: 'combined',
    key: 'canvas-agent',
    beginDispose: () =>
      createCanvasAgentHostShutdownControl({
        projectId: 'combined',
        hostId: host.id,
        generation: host.generation,
      }),
  })
  const disposal = await prepareProjectRuntimes(['combined'])
  return { disposal, hostFinalize }
}

describe('Canvas AgentHost combined cleanup', () => {
  it('host 成功、execution 暂时 false 时第二次只重试 execution', async () => {
    let executionAttempts = 0
    const { disposal, hostFinalize } = await prepareCombined(() => {
      executionAttempts += 1
      return executionAttempts > 1
    })

    await expect(disposal.commit()).resolves.toMatchObject({
      status: 'cleanup_failed',
    })
    expect(hostFinalize).toHaveBeenCalledOnce()
    expect(getAgentHosts()).toHaveLength(1)

    await expect(disposal.commit()).resolves.toEqual({
      status: 'cleanup_complete',
    })
    expect(hostFinalize).toHaveBeenCalledOnce()
    expect(executionAttempts).toBe(2)
    expect(getAgentHosts()).toEqual([])
  })

  it('execution finalize 抛错后保留 host 记录，第二次可完成', async () => {
    let executionAttempts = 0
    const { disposal, hostFinalize } = await prepareCombined(() => {
      executionAttempts += 1
      if (executionAttempts === 1) {
        throw new Error('execution finalize failed')
      }
      return true
    })

    await expect(disposal.commit()).resolves.toMatchObject({
      status: 'cleanup_failed',
      error: expect.objectContaining({
        reason: expect.stringContaining('execution finalize failed'),
      }),
    })
    expect(hostFinalize).toHaveBeenCalledOnce()
    expect(getAgentHosts()).toHaveLength(1)

    await expect(disposal.commit()).resolves.toEqual({
      status: 'cleanup_complete',
    })
    expect(hostFinalize).toHaveBeenCalledOnce()
    expect(executionAttempts).toBe(2)
    expect(getAgentHosts()).toEqual([])
  })
})
