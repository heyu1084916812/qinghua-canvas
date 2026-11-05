import { describe, expect, it, vi } from 'vitest'
import {
  ProjectRuntimeCleanupError,
  retryProjectRuntimeCleanup,
  withPreparedProjectRuntimes,
} from '../ProjectRuntimeRegistry'
import {
  createProjectTreeMutationActions,
  type ProjectTreeMutationPorts,
} from './treeMutationActions'

vi.mock('../ProjectRuntimeRegistry', async () => {
  const actual = await vi.importActual<typeof import('../ProjectRuntimeRegistry')>(
    '../ProjectRuntimeRegistry',
  )
  return {
    ...actual,
    withPreparedProjectRuntimes: vi.fn(
      async (_ids: readonly string[], work: () => Promise<unknown>) => work(),
    ),
    retryProjectRuntimeCleanup: vi.fn(async () => undefined),
  }
})

function harness(overrides: Partial<ProjectTreeMutationPorts> = {}) {
  const state = {
    busy: false,
    renameTarget: null as null | { kind: 'folder' | 'project'; id: string; value: string },
    confirmTarget: null as null | { kind: 'folder' | 'project'; id: string; name: string },
    cleanupOperationId: null as number | null,
  }
  const repo = {
    create: vi.fn(async (input: { workbench: string; folderId?: string | null }) => ({
      id: 'new-project',
      workbench: input.workbench,
    })),
    createFolder: vi.fn(async () => ({ id: 'new-folder', name: '新建文件夹' })),
    rename: vi.fn(async () => undefined),
    renameFolder: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    removeFolder: vi.fn(async () => undefined),
    setProjectFolder: vi.fn(async () => undefined),
  }
  const status = vi.fn()
  const clearMenu = vi.fn()
  const navigate = vi.fn()
  const load = vi.fn(async () => undefined)
  const ports: ProjectTreeMutationPorts = {
    repo: repo as never,
    projects: [
      { id: 'p1', folderId: 'f1' },
      { id: 'p2', folderId: 'f1' },
      { id: 'p3', folderId: null },
    ],
    navigate,
    projectRoute: (workbench, id) => `/${workbench}/${id}`,
    status,
    clearMenu,
    setRenameTarget: (target) => {
      state.renameTarget = target
    },
    setConfirmTarget: (target) => {
      state.confirmTarget = target
    },
    setCleanupOperationId: (id) => {
      state.cleanupOperationId = id
    },
    busy: () => state.busy,
    setBusy: (value) => {
      state.busy = value
    },
    load,
    ...overrides,
  }
  return {
    actions: createProjectTreeMutationActions(ports),
    repo,
    status,
    clearMenu,
    navigate,
    load,
    state,
    ports,
  }
}

describe('projectTreeMutationActions', () => {
  it('新建文件夹成功后进入重命名，新建项目按工作台路由', async () => {
    const { actions, repo, clearMenu, navigate, state } = harness()
    await actions.createFolder()
    expect(clearMenu).toHaveBeenCalledOnce()
    expect(state.renameTarget).toEqual({
      kind: 'folder',
      id: 'new-folder',
      value: '新建文件夹',
    })

    await actions.createProject('ecommerce', 'f1')
    expect(repo.create).toHaveBeenCalledWith({
      workbench: 'ecommerce',
      folderId: 'f1',
    })
    expect(navigate).toHaveBeenCalledWith('/ecommerce/new-project')
  })

  it('空白改名不写仓储；项目 / 文件夹改名分别走唯一入口', async () => {
    const { actions, repo, state } = harness()
    await actions.submitRename({ kind: 'project', id: 'p1', value: '   ' })
    expect(repo.rename).not.toHaveBeenCalled()
    expect(repo.renameFolder).not.toHaveBeenCalled()

    await actions.submitRename({ kind: 'project', id: 'p1', value: '  新画布  ' })
    expect(repo.rename).toHaveBeenCalledWith('p1', '新画布')
    await actions.submitRename({ kind: 'folder', id: 'f1', value: '  新目录  ' })
    expect(repo.renameFolder).toHaveBeenCalledWith('f1', '新目录')
    expect(state.renameTarget).toBeNull()
  })

  it('移出文件夹只处理目标内项目并保留成功播报', async () => {
    const { actions, repo, status } = harness()
    await actions.moveAllOut('f1')
    expect(repo.setProjectFolder.mock.calls).toEqual([
      ['p1', null],
      ['p2', null],
    ])
    expect(status).toHaveBeenCalledWith({
      text: '已把 2 个项目移到未归档',
      tone: 'info',
    })
  })

  it('普通删除经项目运行态锁，成功后播报并关闭确认', async () => {
    const { actions, repo, status, state } = harness()
    const target = { kind: 'project' as const, id: 'p1', name: '项目一' }
    actions.askDelete(target)
    expect(state.confirmTarget).toEqual(target)
    await actions.confirmDelete(target)
    expect(withPreparedProjectRuntimes).toHaveBeenCalledWith(
      ['p1'],
      expect.any(Function),
    )
    expect(repo.remove).toHaveBeenCalledWith('p1')
    expect(status).toHaveBeenCalledWith({
      text: '项目已移到回收站',
      tone: 'info',
    })
    expect(state.confirmTarget).toBeNull()
    expect(state.cleanupOperationId).toBeNull()
    expect(state.busy).toBe(false)
  })

  it('文件夹删除不走项目运行态锁且保留不同播报', async () => {
    vi.mocked(withPreparedProjectRuntimes).mockClear()
    const { actions, repo, status } = harness()
    await actions.confirmDelete({ kind: 'folder', id: 'f1', name: '目录一' })
    expect(repo.removeFolder).toHaveBeenCalledWith('f1')
    expect(withPreparedProjectRuntimes).not.toHaveBeenCalled()
    expect(status).toHaveBeenCalledWith({
      text: '文件夹已删除，里面的项目已移到未归档',
      tone: 'info',
    })
  })

  it('cleanup 失败保留 operationId、关闭确认并显示真实消息', async () => {
    vi.mocked(withPreparedProjectRuntimes).mockRejectedValueOnce(
      new ProjectRuntimeCleanupError(['p1'], new Error('finalize failed'), 17),
    )
    const { actions, status, state, clearMenu } = harness()
    const target = { kind: 'project' as const, id: 'p1', name: '项目一' }
    await actions.confirmDelete(target)
    expect(state.cleanupOperationId).toBe(17)
    expect(state.confirmTarget).toBeNull()
    expect(clearMenu).toHaveBeenCalled()
    expect(status.mock.calls.at(-1)?.[0]).toMatchObject({
      tone: 'error',
      text: expect.stringContaining('finalize failed'),
    })
  })

  it('清理重试按 retry → load → 清 operation → 成功播报顺序执行', async () => {
    const { actions, load, status, state } = harness()
    state.cleanupOperationId = 21
    await actions.retryRuntimeCleanup(['p1', 'p2'])
    expect(retryProjectRuntimeCleanup).toHaveBeenCalledWith(['p1', 'p2'])
    expect(load).toHaveBeenCalledOnce()
    expect(state.cleanupOperationId).toBeNull()
    expect(status).toHaveBeenCalledWith({
      text: '项目运行态清理完成',
      tone: 'info',
    })
    expect(state.busy).toBe(false)
  })

  it('忙时重复删除 / 重试不产生第二次运行态锁或清理', async () => {
    vi.mocked(withPreparedProjectRuntimes).mockClear()
    vi.mocked(retryProjectRuntimeCleanup).mockClear()
    const { actions, state } = harness()
    state.busy = true
    await actions.confirmDelete({ kind: 'project', id: 'p1', name: '项目一' })
    await actions.retryRuntimeCleanup(['p1'])
    expect(withPreparedProjectRuntimes).not.toHaveBeenCalled()
    expect(retryProjectRuntimeCleanup).not.toHaveBeenCalled()
  })
})
