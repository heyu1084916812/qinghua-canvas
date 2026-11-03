import { afterEach, describe, expect, it } from 'vitest'
import type { TaskShutdownControl } from '../features/shared/lifecycle/taskLifecycle'
import {
  disposeProjectRuntimes,
  prepareProjectRuntimes,
  registerProjectRuntime,
  resetProjectRuntimesForTests,
  withPreparedProjectRuntimes,
} from './ProjectRuntimeRegistry'

afterEach(() => {
  resetProjectRuntimesForTests()
})

function control(
  waitForIdle: () => Promise<void>,
  options: {
    reopenable?: () => boolean
    order?: string[]
  } = {},
): TaskShutdownControl {
  let finalized = false
  const reopenable = options.reopenable ?? (() => true)
  return {
    waitForIdle,
    whenIdle: () => waitForIdle(),
    canReopen: () => !finalized && reopenable(),
    reopenIfIdle() {
      if (finalized || !reopenable()) return false
      options.order?.push('reopen')
      return true
    },
    canFinalize: () => !finalized,
    finalize() {
      if (finalized) return false
      finalized = true
      options.order?.push('finalize')
      return true
    },
  }
}

describe('ProjectRuntimeRegistry', () => {
  it('prepare 等待全部 runtime，数据库成功后才 commit', async () => {
    const order: string[] = []
    registerProjectRuntime({
      projectId: 'p1',
      key: 'canvas-agent',
      beginDispose: () =>
        control(async () => {
          order.push('drain-agent')
        }, { order }),
    })
    registerProjectRuntime({
      projectId: 'p1',
      key: 'execution',
      beginDispose: () =>
        control(async () => {
          order.push('drain-execution')
        }, { order }),
    })
    registerProjectRuntime({
      projectId: 'p2',
      key: 'canvas-agent',
      beginDispose: () =>
        control(async () => {
          order.push('other-project')
        }),
    })

    const disposal = await prepareProjectRuntimes(['p1'])
    order.push('database')
    expect(disposal.commit()).toBe(true)
    order.push('purge-agent-tables')

    expect(order).toEqual([
      'drain-agent',
      'drain-execution',
      'database',
      'finalize',
      'finalize',
      'purge-agent-tables',
    ])
  })

  it('wait 失败时保留注册，并在 idle 后恢复可重试状态', async () => {
    let attempts = 0
    registerProjectRuntime({
      projectId: 'p1',
      key: 'canvas-agent',
      beginDispose: () => {
        attempts += 1
        return control(
          async () => {
            if (attempts === 1) throw new Error('flush failed')
          },
          {
            reopenable: () => true,
            order: [],
          },
        )
      },
    })

    await expect(
      disposeProjectRuntimes(['p1']),
    ).rejects.toThrow('flush failed')
    await disposeProjectRuntimes(['p1'])
    expect(attempts).toBe(2)
  })

  it('数据库失败时 rollback，finalize 不会提前执行', async () => {
    const order: string[] = []
    registerProjectRuntime({
      projectId: 'p1',
      key: 'canvas-agent',
      beginDispose: () =>
        control(async () => {
          order.push('drain')
        }, { order }),
    })

    await expect(
      withPreparedProjectRuntimes(['p1'], async () => {
        order.push('database-failed')
        throw new Error('remove failed')
      }),
    ).rejects.toThrow('remove failed')

    expect(order).toEqual([
      'drain',
      'database-failed',
      'reopen',
    ])
  })

  it('延迟队列写超时后不 commit，释放并 idle 后自动恢复', async () => {
    let release!: () => void
    const idle = new Promise<void>((resolve) => {
      release = resolve
    })
    let ready = false
    let attempts = 0
    let reopens = 0
    registerProjectRuntime({
      projectId: 'p1',
      key: 'canvas-agent',
      beginDispose: () => {
        attempts += 1
        const first = attempts === 1
        return {
          waitForIdle: async () => {
            if (first) throw new Error('queue write still pending')
            ready = true
          },
          whenIdle: async () => {
            await idle
            ready = true
          },
          canReopen: () => ready,
          reopenIfIdle() {
            if (!ready) return false
            reopens += 1
            return true
          },
          canFinalize: () => ready,
          finalize: () => ready,
        }
      },
    })

    await expect(
      prepareProjectRuntimes(['p1']),
    ).rejects.toThrow('queue write still pending')
    release()
    await idle
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(reopens).toBe(1)
    await disposeProjectRuntimes(['p1'])
    expect(attempts).toBe(2)
  })

  it('旧代际延迟清理不得删除同 key 的新注册', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let oldBegun = 0
    let newBegun = 0
    const oldRegistration = registerProjectRuntime({
      projectId: 'p1',
      key: 'canvas-agent',
      beginDispose: () => {
        oldBegun += 1
        return control(() => gate)
      },
    })

    const preparing = prepareProjectRuntimes(['p1'])
    const newRegistration = registerProjectRuntime({
      projectId: 'p1',
      key: 'canvas-agent',
      beginDispose: () => {
        newBegun += 1
        return control(async () => undefined)
      },
    })
    expect(newRegistration.generation).not.toBe(
      oldRegistration.generation,
    )

    release()
    const disposal = await preparing
    expect(disposal.commit()).toBe(true)
    await disposeProjectRuntimes(['p1'])

    expect(oldBegun).toBe(1)
    expect(newBegun).toBe(1)
  })
})
