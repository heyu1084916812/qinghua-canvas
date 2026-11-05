import { describe, expect, it, vi } from 'vitest'
import {
  createProjectRuntimeSnapshotStore,
  projectRuntimePendingSnapshotOf,
  type ProjectRuntimeSnapshotSource,
} from './projectRuntimeSnapshots'

function source(
  id: number,
  phase: ProjectRuntimeSnapshotSource['phase'],
  overrides: Partial<ProjectRuntimeSnapshotSource> = {},
): ProjectRuntimeSnapshotSource {
  return {
    id,
    projectIds: [`p${id}`],
    phase,
    workCommitted: false,
    triggerReason: null,
    workReason: null,
    recoveryReason: null,
    ...overrides,
  }
}

describe('projectRuntimeSnapshots', () => {
  it('只投影待处理阶段，并保持公开字段口径', () => {
    expect(
      projectRuntimePendingSnapshotOf(source(1, 'preparing')),
    ).toBeNull()
    expect(
      projectRuntimePendingSnapshotOf(source(1, 'prepared')),
    ).toBeNull()
    expect(
      projectRuntimePendingSnapshotOf(source(1, 'cleanup_complete')),
    ).toBeNull()

    expect(
      projectRuntimePendingSnapshotOf(
        source(2, 'committing', {
          projectIds: ['p2', 'p2'],
          workCommitted: true,
        }),
      ),
    ).toEqual({
      id: 2,
      projectIds: ['p2'],
      status: 'committing',
      workCommitted: true,
      retryable: false,
      reason: '正在清理项目运行态',
      workReason: null,
      recoveryReason: null,
    })

    expect(
      projectRuntimePendingSnapshotOf(
        source(3, 'cleanup_failed', {
          workCommitted: true,
          triggerReason: 'cleanup failed',
        }),
      ),
    ).toMatchObject({
      status: 'cleanup_failed',
      workCommitted: true,
      retryable: true,
      reason: 'cleanup failed',
    })

    expect(
      projectRuntimePendingSnapshotOf(
        source(4, 'recovering', {
          workReason: 'delete failed',
          recoveryReason: 'waiting idle',
        }),
      ),
    ).toMatchObject({
      status: 'recovering',
      retryable: false,
      reason: '原操作：delete failed；恢复：waiting idle',
      workReason: 'delete failed',
      recoveryReason: 'waiting idle',
    })

    expect(
      projectRuntimePendingSnapshotOf(
        source(5, 'recovery_failed', {
          workReason: 'delete failed',
          recoveryReason: 'flush timeout',
        }),
      ),
    ).toMatchObject({
      status: 'recovery_failed',
      retryable: true,
      reason: '原操作：delete failed；恢复：flush timeout',
    })
  })

  it('两个 pending operation 按 id 稳定排序并去重', () => {
    const store = createProjectRuntimeSnapshotStore()
    const listener = vi.fn()
    store.subscribe(listener)

    const first = source(2, 'cleanup_failed', {
      triggerReason: 'second failed',
    })
    const second = source(1, 'recovering', {
      recoveryReason: 'first recovering',
    })
    store.refresh([first, second, first])

    const snapshot = store.getSnapshot()
    expect(snapshot.map((operation) => operation.id)).toEqual([1, 2])
    expect(listener).toHaveBeenCalledOnce()

    store.refresh([second, first])
    expect(store.getSnapshot()).toBe(snapshot)
    expect(listener).toHaveBeenCalledOnce()
  })

  it('单个 pending listener 抛错不阻断其余订阅者', () => {
    const store = createProjectRuntimeSnapshotStore()
    const throwing = vi.fn(() => {
      throw new Error('listener failed')
    })
    const healthy = vi.fn()
    store.subscribe(throwing)
    store.subscribe(healthy)

    expect(() =>
      store.refresh([source(1, 'committing')]),
    ).not.toThrow()
    expect(throwing).toHaveBeenCalledOnce()
    expect(healthy).toHaveBeenCalledOnce()
  })
})
