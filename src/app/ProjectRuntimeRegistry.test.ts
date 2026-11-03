import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TaskShutdownControl } from '../features/shared/lifecycle/taskLifecycle'
import {
  ProjectRuntimeBusyError,
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
    await expect(disposal.commit()).resolves.toBe(true)
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

  it('同 key 重注册沿用旧代际，超时恢复后解除项目锁', async () => {
    let idle = false
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let begins = 0
    const oldRegistration = registerProjectRuntime({
      projectId: 'p1',
      key: 'canvas-agent',
      beginDispose: () => {
        begins += 1
        return {
          waitForIdle: async () => {
            if (!idle) throw new Error('still busy')
          },
          whenIdle: async () => {
            await gate
            idle = true
          },
          canReopen: () => idle,
          reopenIfIdle: () => idle,
          canFinalize: () => idle,
          finalize: () => idle,
        }
      },
    })

    await expect(
      prepareProjectRuntimes(['p1']),
    ).rejects.toThrow('still busy')
    const newRegistration = registerProjectRuntime({
      projectId: 'p1',
      key: 'canvas-agent',
      beginDispose: () => {
        begins += 1
        return control(async () => undefined)
      },
    })
    expect(newRegistration.generation).toBe(oldRegistration.generation)
    await expect(
      prepareProjectRuntimes(['p1']),
    ).rejects.toBeInstanceOf(ProjectRuntimeBusyError)

    release()
    await gate
    await new Promise((resolve) => setTimeout(resolve, 0))
    const disposal = await prepareProjectRuntimes(['p1'])
    expect(await disposal.commit()).toBe(true)
    expect(begins).toBe(2)
  })

  it('同项目并发 prepare 原子失败为 Busy，直到 commit 释放锁', async () => {
    registerProjectRuntime({
      projectId: 'p1',
      key: 'canvas-agent',
      beginDispose: () => control(async () => undefined),
    })
    registerProjectRuntime({
      projectId: 'p2',
      key: 'canvas-agent',
      beginDispose: () => control(async () => undefined),
    })

    const first = await prepareProjectRuntimes(['p1'])
    await expect(
      prepareProjectRuntimes(['p1']),
    ).rejects.toBeInstanceOf(ProjectRuntimeBusyError)
    await expect(
      prepareProjectRuntimes(['p1', 'p2']),
    ).rejects.toBeInstanceOf(ProjectRuntimeBusyError)

    await expect(first.commit()).resolves.toBe(true)
    const p2 = await prepareProjectRuntimes(['p2'])
    await expect(p2.commit()).resolves.toBe(true)
  })

  it('work 期间同 project/key 重注册必须复用旧 registration，commit 后无残留', async () => {
    let oldBegins = 0
    let lateBegins = 0
    const old = registerProjectRuntime({
      projectId: 'p1',
      key: 'canvas-agent',
      beginDispose: () => {
        oldBegins += 1
        return control(async () => undefined)
      },
    })

    await withPreparedProjectRuntimes(['p1'], async () => {
      const late = registerProjectRuntime({
        projectId: 'p1',
        key: 'canvas-agent',
        beginDispose: () => {
          lateBegins += 1
          return control(async () => undefined)
        },
      })
      expect(late.generation).toBe(old.generation)
    })

    await disposeProjectRuntimes(['p1'])
    expect(oldBegins).toBe(1)
    expect(lateBegins).toBe(0)
  })

  it('work 期间新增不同 key 也纳入 commit 等待，不留下第二份 runtime', async () => {
    let releaseLate!: () => void
    const lateGate = new Promise<void>((resolve) => {
      releaseLate = resolve
    })
    let lateBegun = false
    let lateFinalized = false
    registerProjectRuntime({
      projectId: 'p1',
      key: 'canvas-agent',
      beginDispose: () => control(async () => undefined),
    })

    let finished = false
    const removing = withPreparedProjectRuntimes(['p1'], async () => {
      registerProjectRuntime({
        projectId: 'p1',
        key: 'late-runtime',
        beginDispose: () => {
          lateBegun = true
          return {
            waitForIdle: () => lateGate,
            whenIdle: () => lateGate,
            canReopen: () => true,
            reopenIfIdle: () => true,
            canFinalize: () => true,
            finalize: () => {
              lateFinalized = true
              return true
            },
          }
        },
      })
    }).then(() => {
      finished = true
    })

    for (let i = 0; i < 10 && !lateBegun; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    expect(lateBegun).toBe(true)
    expect(finished).toBe(false)
    releaseLate()
    await removing

    expect(lateFinalized).toBe(true)
    await disposeProjectRuntimes(['p1'])
  })

  it('work 已成功时 commit 清理异常不反向误报数据库失败', async () => {
    registerProjectRuntime({
      projectId: 'p1',
      key: 'canvas-agent',
      beginDispose: () => ({
        ...control(async () => undefined),
        finalize() {
          throw new Error('host cleanup failed')
        },
      }),
    })
    const work = vi.fn(async () => 'database removed')

    await expect(
      withPreparedProjectRuntimes(['p1'], work),
    ).resolves.toBe('database removed')
    expect(work).toHaveBeenCalledOnce()
  })

  it('超时恢复尚未 idle 时锁保持，第二次 prepare 不能覆盖 attempt', async () => {
    let idle = false
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
      })
    registerProjectRuntime({
      projectId: 'p1',
      key: 'canvas-agent',
      beginDispose: () => ({
        waitForIdle: async () => {
          if (!idle) throw new Error('still busy')
        },
        whenIdle: async () => {
          await gate
          idle = true
        },
        canReopen: () => idle,
        reopenIfIdle: () => idle,
        canFinalize: () => idle,
        finalize: () => idle,
      }),
    })

    await expect(
      prepareProjectRuntimes(['p1']),
    ).rejects.toThrow('still busy')
    await expect(
      prepareProjectRuntimes(['p1']),
    ).rejects.toBeInstanceOf(ProjectRuntimeBusyError)
    release()
    await gate
    await new Promise((resolve) => setTimeout(resolve, 0))
    const retry = await prepareProjectRuntimes(['p1'])
    await expect(retry.commit()).resolves.toBe(true)
  })
})
