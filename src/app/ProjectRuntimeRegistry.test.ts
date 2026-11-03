import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TaskShutdownControl } from '../features/shared/lifecycle/taskLifecycle'
import {
  ProjectRuntimeBusyError,
  ProjectRuntimeCleanupError,
  ProjectRuntimeRecoveryError,
  ProjectRuntimeRetryScopeError,
  disposeProjectRuntimes,
  getProjectRuntimePendingSnapshot,
  prepareProjectRuntimes,
  registerProjectRuntime,
  resetProjectRuntimesForTests,
  retryProjectRuntimeCleanup,
  retryProjectRuntimeOperation,
  subscribeProjectRuntimePending,
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

async function waitForPending(
  predicate: (
    snapshot: ReturnType<typeof getProjectRuntimePendingSnapshot>,
  ) => boolean,
): Promise<ReturnType<typeof getProjectRuntimePendingSnapshot>> {
  for (let i = 0; i < 30; i += 1) {
    const snapshot = getProjectRuntimePendingSnapshot()
    if (predicate(snapshot)) return snapshot
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error('pending snapshot did not reach expected state')
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
    await expect(disposal.commit()).resolves.toEqual({
      status: 'cleanup_complete',
    })
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
    ).rejects.toBeInstanceOf(ProjectRuntimeRecoveryError)
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
    ).rejects.toBeInstanceOf(ProjectRuntimeRecoveryError)
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
    await expect(disposal.commit()).resolves.toEqual({
      status: 'cleanup_complete',
    })
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

    await expect(first.commit()).resolves.toEqual({
      status: 'cleanup_complete',
    })
    const p2 = await prepareProjectRuntimes(['p2'])
    await expect(p2.commit()).resolves.toEqual({
      status: 'cleanup_complete',
    })
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

  it.each([
    ['canFinalize 为 false', 'blocked'],
    ['finalize 返回 false', 'false'],
    ['finalize 抛错', 'throw'],
  ] as const)(
    '%s 时保留锁与注册，修正后只重试 cleanup',
    async (_label, failure) => {
      let ready = false
      let begins = 0
      registerProjectRuntime({
        projectId: 'p1',
        key: 'canvas-agent',
        beginDispose: () => {
          begins += 1
          let finalized = false
          return {
            waitForIdle: async () => undefined,
            whenIdle: async () => undefined,
            canReopen: () => ready,
            reopenIfIdle: () => ready,
            canFinalize: () =>
              ready || failure !== 'blocked',
            finalize() {
              if (!ready && failure === 'false') return false
              if (!ready && failure === 'throw') {
                throw new Error('host cleanup failed')
              }
              finalized = true
              return finalized
            },
          }
        },
      })
      const work = vi.fn(async () => 'database removed')

      await expect(
        withPreparedProjectRuntimes(['p1'], work),
      ).rejects.toBeInstanceOf(ProjectRuntimeCleanupError)
      expect(work).toHaveBeenCalledOnce()
      await expect(
        prepareProjectRuntimes(['p1']),
      ).rejects.toBeInstanceOf(ProjectRuntimeBusyError)

      ready = true
      await expect(
        withPreparedProjectRuntimes(['p1'], work),
      ).resolves.toBe('database removed')
      expect(work).toHaveBeenCalledOnce()
      expect(begins).toBe(1)
      await expect(
        disposeProjectRuntimes(['p1']),
      ).resolves.toBeUndefined()
    },
  )

  it('仓储 work 抛错时只 rollback，不 finalize', async () => {
    const finalize = vi.fn(() => true)
    registerProjectRuntime({
      projectId: 'p1',
      key: 'canvas-agent',
      beginDispose: () => ({
        ...control(async () => undefined),
        finalize,
      }),
    })

    await expect(
      withPreparedProjectRuntimes(['p1'], async () => {
        throw new Error('database remove failed')
      }),
    ).rejects.toThrow('database remove failed')
    expect(finalize).not.toHaveBeenCalled()
  })

  it('late runtime resolve 后才允许 commit', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    registerProjectRuntime({
      projectId: 'p1',
      key: 'canvas-agent',
      beginDispose: () => control(async () => undefined),
    })
    const disposal = await prepareProjectRuntimes(['p1'])
    registerProjectRuntime({
      projectId: 'p1',
      key: 'late-runtime',
      beginDispose: () => ({
        waitForIdle: () => gate,
        whenIdle: () => gate,
        canReopen: () => true,
        reopenIfIdle: () => true,
        canFinalize: () => true,
        finalize: () => true,
      }),
    })

    let settled = false
    const committing = disposal.commit().then((result) => {
      settled = true
      return result
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(settled).toBe(false)

    release()
    await expect(committing).resolves.toMatchObject({
      status: 'cleanup_complete',
    })
  })

  it('late runtime reject 保留锁与注册，重试可清理', async () => {
    let attempts = 0
    registerProjectRuntime({
      projectId: 'p1',
      key: 'canvas-agent',
      beginDispose: () => control(async () => undefined),
    })
    const disposal = await prepareProjectRuntimes(['p1'])
    registerProjectRuntime({
      projectId: 'p1',
      key: 'late-runtime',
      beginDispose: () => ({
        waitForIdle: async () => {
          attempts += 1
          if (attempts === 1) throw new Error('late idle failed')
        },
        whenIdle: async () => undefined,
        canReopen: () => true,
        reopenIfIdle: () => true,
        canFinalize: () => true,
        finalize: () => true,
      }),
    })

    await expect(disposal.commit()).resolves.toMatchObject({
      status: 'cleanup_failed',
      error: expect.objectContaining({
        message: expect.stringContaining('late idle failed'),
      }),
    })
    await expect(
      prepareProjectRuntimes(['p1']),
    ).rejects.toBeInstanceOf(ProjectRuntimeBusyError)
    await expect(disposal.commit()).resolves.toMatchObject({
      status: 'cleanup_complete',
    })
    expect(attempts).toBe(2)
  })

  it('late runtime 永久 pending 会超时，之后仍可再次清理', async () => {
    let attempts = 0
    registerProjectRuntime({
      projectId: 'p1',
      key: 'canvas-agent',
      beginDispose: () => control(async () => undefined),
    })
    const disposal = await prepareProjectRuntimes(['p1'], {
      shutdownTimeoutMs: 5,
    })
    registerProjectRuntime({
      projectId: 'p1',
      key: 'late-runtime',
      beginDispose: () => ({
        waitForIdle: () => {
          attempts += 1
          return attempts === 1
            ? new Promise<void>(() => undefined)
            : Promise.resolve()
        },
        whenIdle: () => new Promise<void>(() => undefined),
        canReopen: () => true,
        reopenIfIdle: () => true,
        canFinalize: () => true,
        finalize: () => true,
      }),
    })

    await expect(disposal.commit()).resolves.toMatchObject({
      status: 'cleanup_failed',
      error: expect.objectContaining({
        name: 'ProjectRuntimeCleanupError',
        reason: expect.stringContaining('超时'),
      }),
    })
    await expect(
      prepareProjectRuntimes(['p1']),
    ).rejects.toBeInstanceOf(ProjectRuntimeBusyError)
    await expect(disposal.commit()).resolves.toMatchObject({
      status: 'cleanup_complete',
    })
    expect(attempts).toBe(2)
  })

  it('releaseFinalized 抛错进入 cleanup_failed，重试可完成', async () => {
    let releaseAttempts = 0
    let finalized = false
    registerProjectRuntime({
      projectId: 'p1',
      key: 'canvas-agent',
      beginDispose: () => ({
        waitForIdle: async () => {
          if (finalized) throw new Error('finalized control closed')
        },
        whenIdle: async () => {
          if (finalized) throw new Error('finalized control closed')
        },
        canReopen: () => !finalized,
        reopenIfIdle: () => !finalized,
        canFinalize: () => true,
        finalize() {
          finalized = true
          return true
        },
        releaseFinalized() {
          releaseAttempts += 1
          if (releaseAttempts === 1) {
            throw new Error('release failed')
          }
        },
      }),
    })
    const disposal = await prepareProjectRuntimes(['p1'])

    await expect(disposal.commit()).resolves.toMatchObject({
      status: 'cleanup_failed',
      error: expect.objectContaining({
        reason: expect.stringContaining('release failed'),
      }),
    })
    await expect(
      prepareProjectRuntimes(['p1']),
    ).rejects.toBeInstanceOf(ProjectRuntimeBusyError)
    await expect(disposal.commit()).resolves.toEqual({
      status: 'cleanup_complete',
    })
    expect(releaseAttempts).toBe(2)
  })

  it('初始 prepare 连续两次超时后进入可重试 recovery，最终可重新删除', async () => {
    let idle = false
    let begins = 0
    registerProjectRuntime({
      projectId: 'p1',
      key: 'canvas-agent',
      beginDispose: () => {
        begins += 1
        return {
          waitForIdle: async () => {
            if (begins === 1) throw new Error('first wait timeout')
          },
          whenIdle: () => new Promise<void>(() => undefined),
          canReopen: () => idle,
          reopenIfIdle: () => idle,
          canFinalize: () => idle,
          finalize: () => idle,
        }
      },
    })
    const work = vi.fn(async () => 'database removed')

    await expect(
      withPreparedProjectRuntimes(['p1'], work, {
        shutdownTimeoutMs: 5,
      }),
    ).rejects.toMatchObject({
      name: 'ProjectRuntimeRecoveryError',
      workCommitted: false,
    })
    expect(work).not.toHaveBeenCalled()
    const pending = await waitForPending(
      (snapshot) =>
        snapshot[0]?.status === 'recovery_failed',
    )
    expect(pending[0]).toMatchObject({
      projectIds: ['p1'],
      workCommitted: false,
      retryable: true,
    })

    idle = true
    await expect(
      withPreparedProjectRuntimes(['p1'], work, {
        shutdownTimeoutMs: 5,
      }),
    ).resolves.toBe('database removed')
    expect(work).toHaveBeenCalledOnce()
    expect(getProjectRuntimePendingSnapshot()).toEqual([])
    expect(begins).toBe(2)
  })

  it('work 抛错且 late runtime pending 时返回 recovery 错误，恢复后可重新执行删除', async () => {
    let lateReady = false
    const work = vi.fn(async () => {
      if (work.mock.calls.length === 1) {
        registerProjectRuntime({
          projectId: 'p1',
          key: 'late-runtime',
          beginDispose: () => ({
            waitForIdle: async () => undefined,
            whenIdle: () =>
              lateReady
                ? Promise.resolve()
                : new Promise<void>(() => undefined),
            canReopen: () => lateReady,
            reopenIfIdle: () => lateReady,
            canFinalize: () => lateReady,
            finalize: () => lateReady,
          }),
        })
        throw new Error('repo remove failed')
      }
      return 'database removed'
    })
    registerProjectRuntime({
      projectId: 'p1',
      key: 'canvas-agent',
      beginDispose: () => control(async () => undefined),
    })

    await expect(
      withPreparedProjectRuntimes(['p1'], work, {
        shutdownTimeoutMs: 5,
      }),
    ).rejects.toBeInstanceOf(ProjectRuntimeRecoveryError)
    const pending = await waitForPending(
      (snapshot) =>
        snapshot[0]?.status === 'recovery_failed',
    )
    expect(pending[0]).toMatchObject({
      workCommitted: false,
      recoveryReason: expect.stringContaining('超时'),
      workReason: expect.stringContaining('repo remove failed'),
    })

    lateReady = true
    await expect(
      withPreparedProjectRuntimes(['p1'], work, {
        shutdownTimeoutMs: 5,
      }),
    ).resolves.toBe('database removed')
    expect(work).toHaveBeenCalledTimes(2)
    expect(getProjectRuntimePendingSnapshot()).toEqual([])
  })

  it('普通 work 失败且 rollback 成功时不产生 recovery 待办', async () => {
    registerProjectRuntime({
      projectId: 'p1',
      key: 'canvas-agent',
      beginDispose: () => control(async () => undefined),
    })

    await expect(
      withPreparedProjectRuntimes(['p1'], async () => {
        throw new Error('normal work failure')
      }),
    ).rejects.toThrow('normal work failure')
    expect(getProjectRuntimePendingSnapshot()).toEqual([])
  })

  it('cleanup 子集或混合集合 retry 明确报范围错误，不清理待办', async () => {
    let ready = false
    for (const projectId of ['p1', 'p2']) {
      registerProjectRuntime({
        projectId,
        key: 'canvas-agent',
        beginDispose: () => ({
          waitForIdle: async () => undefined,
          whenIdle: async () => undefined,
          canReopen: () => ready,
          reopenIfIdle: () => ready,
          canFinalize: () => true,
          finalize: () => ready,
        }),
      })
    }
    const work = vi.fn(async () => 'deleted')
    await expect(
      withPreparedProjectRuntimes(['p1', 'p2'], work),
    ).rejects.toBeInstanceOf(ProjectRuntimeCleanupError)
    const [operation] = getProjectRuntimePendingSnapshot()
    expect(operation).toMatchObject({
      projectIds: ['p1', 'p2'],
      status: 'cleanup_failed',
      workCommitted: true,
    })
    const unrelatedActive = await prepareProjectRuntimes(['p3'])

    await expect(
      retryProjectRuntimeCleanup(['p1']),
    ).rejects.toBeInstanceOf(ProjectRuntimeRetryScopeError)
    await expect(
      retryProjectRuntimeCleanup(['p1', 'p3']),
    ).rejects.toBeInstanceOf(ProjectRuntimeRetryScopeError)
    await expect(
      retryProjectRuntimeCleanup(['unrelated']),
    ).resolves.toBeUndefined()
    expect(getProjectRuntimePendingSnapshot()).toEqual([operation])

    ready = true
    await retryProjectRuntimeOperation(operation!.id)
    expect(getProjectRuntimePendingSnapshot()).toEqual([])
    await expect(unrelatedActive.commit()).resolves.toEqual({
      status: 'cleanup_complete',
    })
  })

  it('pending 快照在 cleanup 失败与重试成功时通知订阅者', async () => {
    let ready = false
    const listener = vi.fn()
    const unsubscribe = subscribeProjectRuntimePending(listener)
    registerProjectRuntime({
      projectId: 'p1',
      key: 'canvas-agent',
      beginDispose: () => ({
        waitForIdle: async () => undefined,
        whenIdle: async () => undefined,
        canReopen: () => ready,
        reopenIfIdle: () => ready,
        canFinalize: () => true,
        finalize: () => ready,
      }),
    })

    await expect(
      withPreparedProjectRuntimes(['p1'], async () => 'deleted'),
    ).rejects.toBeInstanceOf(ProjectRuntimeCleanupError)
    expect(getProjectRuntimePendingSnapshot()).toHaveLength(1)
    expect(listener).toHaveBeenCalled()

    ready = true
    await retryProjectRuntimeCleanup(['p1'])
    expect(getProjectRuntimePendingSnapshot()).toEqual([])
    unsubscribe()
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
    ).rejects.toBeInstanceOf(ProjectRuntimeRecoveryError)
    await expect(
      prepareProjectRuntimes(['p1']),
    ).rejects.toBeInstanceOf(ProjectRuntimeBusyError)
    release()
    await gate
    await new Promise((resolve) => setTimeout(resolve, 0))
    const retry = await prepareProjectRuntimes(['p1'])
    await expect(retry.commit()).resolves.toEqual({
      status: 'cleanup_complete',
    })
  })
})
