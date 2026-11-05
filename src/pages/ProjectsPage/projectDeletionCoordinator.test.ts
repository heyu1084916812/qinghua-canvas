import { describe, expect, it, vi } from 'vitest'
import {
  ProjectRuntimeCleanupError,
  retryProjectRuntimeCleanup,
  withPreparedProjectRuntimes,
} from '../../app/ProjectRuntimeRegistry'
import {
  deleteProjectsWithRuntime,
  reportDeleteFailure,
  retryProjectCleanup,
  type RetryCleanupPorts,
} from './projectDeletionCoordinator'

vi.mock('../../app/ProjectRuntimeRegistry', async () => {
  const actual = await vi.importActual<typeof import('../../app/ProjectRuntimeRegistry')>(
    '../../app/ProjectRuntimeRegistry',
  )
  return {
    ...actual,
    withPreparedProjectRuntimes: vi.fn(
      async (_ids: readonly string[], work: () => Promise<unknown>) => work(),
    ),
    retryProjectRuntimeCleanup: vi.fn(async () => undefined),
  }
})

function ports() {
  const state = { busy: false, cleanupOperationId: null as number | null }
  const value: RetryCleanupPorts = {
    status: vi.fn(),
    setCleanupOperationId: (id) => {
      state.cleanupOperationId = id
    },
    busy: () => state.busy,
    setBusy: (busy) => {
      state.busy = busy
    },
    load: vi.fn(async () => undefined),
    refreshTrash: vi.fn(async () => undefined),
    trashOpen: () => true,
  }
  return { value, state }
}

describe('projectDeletionCoordinator', () => {
  it('cleanup 错误写 operationId 并保留原消息，普通错误带前缀', () => {
    const cleanup = ports()
    const error = new ProjectRuntimeCleanupError(
      ['p1'],
      new Error('finalize failed'),
      42,
    )
    reportDeleteFailure(cleanup.value, error, '删除失败')
    expect(cleanup.state.cleanupOperationId).toBe(42)
    expect(cleanup.value.status).toHaveBeenCalledWith({
      text: error.message,
      tone: 'error',
    })

    const normal = ports()
    reportDeleteFailure(normal.value, new Error('disk full'), '彻底删除失败')
    expect(normal.state.cleanupOperationId).toBeNull()
    expect(normal.value.status).toHaveBeenCalledWith({
      text: '彻底删除失败：disk full',
      tone: 'error',
    })
  })

  it('删除把完整 ID 集合交给唯一项目运行态锁入口并保留仓储返回值', async () => {
    const softDelete = vi.fn(async () => 3)
    const result = await deleteProjectsWithRuntime(['p1', 'p2'], softDelete)
    expect(withPreparedProjectRuntimes).toHaveBeenCalledWith(
      ['p1', 'p2'],
      expect.any(Function),
    )
    const wrappedWork = vi.mocked(withPreparedProjectRuntimes).mock.calls[0]?.[1]
    expect(wrappedWork).toBeTypeOf('function')
    expect(softDelete).toHaveBeenCalledOnce()
    expect(result).toBe(3)
  })

  it('清理重试按 retry → load → trash refresh → 清 operation → 成功播报', async () => {
    const { value, state } = ports()
    state.cleanupOperationId = 7
    await retryProjectCleanup(value, { projectIds: ['p1', 'p2'] }, false)
    expect(retryProjectRuntimeCleanup).toHaveBeenCalledWith(['p1', 'p2'])
    expect(value.load).toHaveBeenCalledOnce()
    expect(value.refreshTrash).toHaveBeenCalledOnce()
    expect(state.cleanupOperationId).toBeNull()
    expect(value.status).toHaveBeenCalledWith({
      text: '项目运行态清理完成',
      tone: 'info',
    })
    expect(state.busy).toBe(false)
  })

  it('回收站未打开时不刷新回收站；忙 / 提交中 / 无待清理项均不重试', async () => {
    const { value } = ports()
    value.trashOpen = () => false
    await retryProjectCleanup(value, { projectIds: ['p1'] }, false)
    expect(value.refreshTrash).not.toHaveBeenCalled()

    vi.mocked(retryProjectRuntimeCleanup).mockClear()
    const busy = ports()
    busy.state.busy = true
    await retryProjectCleanup(busy.value, { projectIds: ['p1'] }, false)
    await retryProjectCleanup(ports().value, { projectIds: ['p1'] }, true)
    await retryProjectCleanup(ports().value, null, false)
    expect(retryProjectRuntimeCleanup).not.toHaveBeenCalled()
  })

  it('清理重试失败保留真实 cleanup operationId 且最终解除忙碌', async () => {
    vi.mocked(retryProjectRuntimeCleanup).mockRejectedValueOnce(
      new ProjectRuntimeCleanupError(['p1'], new Error('still dirty'), 99),
    )
    const { value, state } = ports()
    await retryProjectCleanup(value, { projectIds: ['p1'] }, false)
    expect(state.cleanupOperationId).toBe(99)
    expect(value.status).toHaveBeenCalledWith({
      text: expect.stringContaining('still dirty'),
      tone: 'error',
    })
    expect(state.busy).toBe(false)
  })
})
