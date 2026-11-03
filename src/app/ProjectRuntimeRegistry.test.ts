import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  disposeProjectRuntimes,
  registerProjectRuntime,
  resetProjectRuntimesForTests,
} from './ProjectRuntimeRegistry'

afterEach(() => {
  resetProjectRuntimesForTests()
})

describe('ProjectRuntimeRegistry', () => {
  it('按 project 等待 agent / execution / store 的复合 disposer，再允许调用方 purge', async () => {
    const order: string[] = []
    registerProjectRuntime({
      projectId: 'p1',
      key: 'canvas-agent',
      dispose: async () => {
        order.push('abort-agent')
        await Promise.resolve()
        order.push('dispose-execution')
        order.push('forget-store')
      },
    })
    registerProjectRuntime({
      projectId: 'p2',
      key: 'canvas-agent',
      dispose: async () => {
        order.push('other-project')
      },
    })

    await disposeProjectRuntimes(['p1'])
    order.push('purge-agent-tables')

    expect(order).toEqual([
      'abort-agent',
      'dispose-execution',
      'forget-store',
      'purge-agent-tables',
    ])
  })

  it('disposer 失败时保留注册，删除流程不能静默继续', async () => {
    const dispose = vi.fn(async () => {
      throw new Error('flush failed')
    })
    registerProjectRuntime({
      projectId: 'p1',
      key: 'canvas-agent',
      dispose,
    })

    await expect(
      disposeProjectRuntimes(['p1']),
    ).rejects.toThrow('flush failed')
    await expect(
      disposeProjectRuntimes(['p1']),
    ).rejects.toThrow('flush failed')
    expect(dispose).toHaveBeenCalledTimes(2)
  })
})
