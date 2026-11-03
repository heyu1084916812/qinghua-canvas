import { createElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import TestRenderer, { act } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PlatformProvider } from '../../app/providers/PlatformProvider'
import {
  registerProjectRuntime,
  resetProjectRuntimesForTests,
} from '../../app/ProjectRuntimeRegistry'
import { createMemoryPlatform } from '../../platform/memory'
import { createProjectRepository } from '../../state/project/repository'
import { resetCanvasStoreCache } from '../../state/workbenches/canvas/storeCache'
import { ProjectsPage } from './ProjectsPage'
import {
  createTaskLifecycle,
  type TaskShutdownControl,
} from '../../features/shared/lifecycle/taskLifecycle'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  resetProjectRuntimesForTests()
  resetCanvasStoreCache()
})

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await Promise.resolve()
  })
}

function textOf(node: TestRenderer.ReactTestInstance): string {
  return node.children
    .map((child) =>
      typeof child === 'string' ? child : '',
    )
    .join('')
}

function lifecycleControl(
  lifecycle = createTaskLifecycle(),
): TaskShutdownControl {
  const attempt = lifecycle.beginClose()
  return {
    waitForIdle: () => lifecycle.waitForIdle(100),
    whenIdle: lifecycle.whenIdle,
    canReopen: () => lifecycle.canReopen(attempt),
    reopenIfIdle: () => lifecycle.reopenIfIdle(attempt),
    canFinalize: () => lifecycle.canFinalize(attempt),
    finalize: () => lifecycle.finalizeClose(attempt),
  }
}

async function renderProjectsPage(platform: ReturnType<typeof createMemoryPlatform>) {
  let root!: TestRenderer.ReactTestRenderer
  await act(async () => {
    root = TestRenderer.create(
      createElement(
        PlatformProvider,
        { create: () => platform },
        createElement(
          MemoryRouter,
          { initialEntries: ['/projects'] },
          createElement(ProjectsPage),
        ),
      ),
    )
  })
  await settle()
  return root
}

describe('ProjectsPage delete failure', () => {
  it('单删 dispose 失败时保留确认框、项目与真实错误', async () => {
    const platform = createMemoryPlatform()
    const repo = createProjectRepository(platform.storage)
    await platform.storage.open()
    const project = await repo.create({ name: '保留项目' })
    const beginDispose = vi.fn((): TaskShutdownControl => ({
      waitForIdle: async () => {
        throw new Error('flush timeout')
      },
      whenIdle: async () => undefined,
      canReopen: () => true,
      reopenIfIdle: () => true,
      canFinalize: () => true,
      finalize: () => true,
    }))
    registerProjectRuntime({
      projectId: project.id,
      key: 'canvas-agent',
      beginDispose,
    })
    const root = await renderProjectsPage(platform)

    const card = root.root.find(
      (node) => node.props['data-project-card'] === project.id,
    )
    act(() => {
      card.find(
        (node) =>
          node.type === 'button' &&
          node.props['aria-label'] === '项目菜单',
      ).props.onClick()
    })
    act(() => {
      card.find(
        (node) =>
          node.type === 'button' &&
          node.props.role === 'menuitem' &&
          textOf(node) === '删除',
      ).props.onClick({ stopPropagation: vi.fn() })
    })
    await act(async () => {
      await card.find(
        (node) =>
          node.type === 'button' &&
          textOf(node) === '确认',
      ).props.onClick()
    })

    expect(beginDispose).toHaveBeenCalledOnce()
    expect(
      root.root.findAll(
        (node) => node.props['data-project-card'] === project.id,
      ),
    ).toHaveLength(1)
    expect(
      card.findAll(
        (node) =>
          node.type === 'button' &&
          textOf(node) === '确认',
      ),
    ).toHaveLength(1)
    const status = root.root.find(
      (node) => node.props['data-status-tone'] !== undefined,
    )
    expect(status.props['data-status-tone']).toBe('error')
    expect(textOf(status)).toContain('flush timeout')
    expect((await repo.get(project.id))?.deletedAt).toBeUndefined()

    act(() => root.unmount())
  })

  it('批量删除 dispose 失败时保留二次确认与选择', async () => {
    const platform = createMemoryPlatform()
    const repo = createProjectRepository(platform.storage)
    await platform.storage.open()
    const project = await repo.create({ name: '批量保留' })
    registerProjectRuntime({
      projectId: project.id,
      key: 'canvas-agent',
      beginDispose: () => ({
        waitForIdle: async () => {
          throw new Error('dispose pending')
        },
        whenIdle: async () => undefined,
        canReopen: () => true,
        reopenIfIdle: () => true,
        canFinalize: () => true,
        finalize: () => true,
      }),
    })
    const root = await renderProjectsPage(platform)

    act(() => {
      root.root.find(
        (node) => node.props['data-project-select-toggle'] !== undefined,
      ).props.onClick()
    })
    act(() => {
      root.root.find(
        (node) => node.props['data-project-card'] === project.id,
      ).props.onClick()
    })
    act(() => {
      root.root.find(
        (node) => node.props['data-project-bulk-delete'] !== undefined,
      ).props.onClick()
    })
    await act(async () => {
      await root.root.find(
        (node) => node.props['data-project-bulk-confirm'] !== undefined,
      ).props.onClick()
    })

    expect(
      root.root.findAll(
        (node) => node.props['data-project-bulk-confirm'] !== undefined,
      ),
    ).toHaveLength(1)
    expect(
      root.root.find(
        (node) => node.props['data-status-tone'] !== undefined,
      ).props['data-status-tone'],
    ).toBe('error')
    expect((await repo.get(project.id))?.deletedAt).toBeUndefined()

    act(() => root.unmount())
  })

  it('仓储失败回滚 draining runtime，确认框保留且可再次删除', async () => {
    const platform = createMemoryPlatform()
    const repo = createProjectRepository(platform.storage)
    await platform.storage.open()
    const project = await repo.create({ name: '仓储恢复' })
    const lifecycle = createTaskLifecycle()
    registerProjectRuntime({
      projectId: project.id,
      key: 'canvas-agent',
      beginDispose: () => lifecycleControl(lifecycle),
    })
    const root = await renderProjectsPage(platform)
    const card = root.root.find(
      (node) => node.props['data-project-card'] === project.id,
    )

    const originalPut = platform.storage.put.bind(platform.storage)
    const put = vi.spyOn(platform.storage, 'put').mockImplementation(
      async (table, row) => {
        if (
          table === 'projects' &&
          typeof row.deletedAt === 'number'
        ) {
          throw new Error('disk full')
        }
        return originalPut(table, row)
      },
    )

    act(() => {
      card.find(
        (node) =>
          node.type === 'button' &&
          node.props['aria-label'] === '项目菜单',
      ).props.onClick()
    })
    act(() => {
      card.find(
        (node) =>
          node.type === 'button' &&
          node.props.role === 'menuitem' &&
          textOf(node) === '删除',
      ).props.onClick({ stopPropagation: vi.fn() })
    })
    await act(async () => {
      await card.find(
        (node) =>
          node.type === 'button' &&
          textOf(node) === '确认',
      ).props.onClick()
    })

    expect(lifecycle.state).toBe('open')
    expect((await repo.get(project.id))?.deletedAt).toBeUndefined()
    expect(
      textOf(
        root.root.find(
          (node) => node.props['data-status-tone'] !== undefined,
        ),
      ),
    ).toContain('disk full')

    put.mockRestore()
    await act(async () => {
      await root.root.find(
        (node) =>
          node.type === 'button' &&
          textOf(node) === '确认',
      ).props.onClick()
    })
    expect((await repo.get(project.id))?.deletedAt).toBeTypeOf('number')
    act(() => root.unmount())
  })
})
