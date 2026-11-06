import type { DragEvent } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ImportResult } from '../../../state/project/flowIo'
import * as ProjectsPageModule from '../ProjectsPage'
import { HomeEmptyState, ProjectCard } from '../ProjectsPageViews'
import {
  applyProjectImportResult,
  dropProjectFlow,
  exportProjectFlow,
  importProjectFlow,
  type ProjectActionPorts,
} from './projectActionCoordinator'

const flowIo = vi.hoisted(() => ({
  importProjectFile: vi.fn(),
  importProjectFromFile: vi.fn(),
  exportProject: vi.fn(),
}))

vi.mock('../../../state/project/flowIo', () => flowIo)

const imported = {
  cancelled: false,
  project: { name: '新项目' },
  missingModels: [],
  flowName: 'new.flow.json',
  repaired: { droppedEdges: 0, detachedParents: 0 },
} as unknown as ImportResult

function createPorts() {
  const calls: Array<[string] | [string, unknown]> = []
  const state: { busy: boolean; dragging: boolean; menuId: string | null } = {
    busy: false,
    dragging: true,
    menuId: 'p1',
  }
  const value = {
    platform: {} as never,
    repo: {} as never,
    status: vi.fn((notice: unknown) => calls.push(['status', notice])),
    load: vi.fn(async () => {
      calls.push(['load'] as [string])
    }),
    busy: () => state.busy,
    setBusy: (next: boolean) => {
      state.busy = next
      calls.push(['setBusy', next])
    },
    closeMenu: () => {
      state.menuId = null
      calls.push(['closeMenu'] as [string])
    },
    setDragging: (next: boolean) => {
      state.dragging = next
      calls.push(['setDragging', next])
    },
  } satisfies ProjectActionPorts
  return { value, state, calls }
}

function dropEvent(file: Record<string, unknown> | null) {
  return {
    dataTransfer: { files: file ? [file] : [] },
    preventDefault: vi.fn(),
  } as unknown as DragEvent<HTMLDivElement>
}

describe('projectActionCoordinator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('保留页面公共导出与四个动作端口身份', () => {
    expect(ProjectsPageModule.ProjectsPage).toBeTypeOf('function')
    expect(ProjectsPageModule.ProjectCard).toBe(ProjectCard)
    expect(ProjectsPageModule.HomeEmptyState).toBe(HomeEmptyState)
    expect(importProjectFlow).toBeTypeOf('function')
    expect(applyProjectImportResult).toBeTypeOf('function')
    expect(dropProjectFlow).toBeTypeOf('function')
    expect(exportProjectFlow).toBeTypeOf('function')
  })

  it('忙碌守卫覆盖菜单导入、拖放与导出，且不会解除别人的锁', async () => {
    const { value, state } = createPorts()
    state.busy = true
    const event = dropEvent({ name: 'project.flow.json', size: 2, type: 'application/json' })
    await importProjectFlow(value)
    await dropProjectFlow(value, event)
    await exportProjectFlow(value, 'p1', '项目')
    expect(flowIo.importProjectFile).not.toHaveBeenCalled()
    expect(flowIo.importProjectFromFile).not.toHaveBeenCalled()
    expect(flowIo.exportProject).not.toHaveBeenCalled()
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(state.busy).toBe(true)
  })

  it('非 JSON 拖放只关拖拽层并给出原错误，不 preventDefault、不导入', async () => {
    const { value, state, calls } = createPorts()
    const event = dropEvent({ name: 'cover.png', size: 2, type: 'image/png' })
    await dropProjectFlow(value, event)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(state.dragging).toBe(false)
    expect(flowIo.importProjectFromFile).not.toHaveBeenCalled()
    expect(calls).toContainEqual(['setDragging', false])
    expect(value.status).toHaveBeenCalledWith({
      text: '这里只接受 .flow.json 项目文件（拖进来的是别的类型）',
      tone: 'error',
    })
  })

  it('菜单导入按 busy → 读文件 → load → 成功播报 → 解锁，取消不播报', async () => {
    const { value, state, calls } = createPorts()
    vi.mocked(flowIo.importProjectFile).mockResolvedValueOnce(imported)
    await importProjectFlow(value)
    expect(flowIo.importProjectFile).toHaveBeenCalledWith(value.platform, value.repo)
    expect(value.load).toHaveBeenCalledOnce()
    expect(value.status).toHaveBeenCalledWith({ text: '已导入「新项目」', tone: 'info' })
    expect(calls.map(([name]) => name)).toEqual([
      'setBusy', 'load', 'status', 'setBusy',
    ])
    expect(state.busy).toBe(false)

    vi.mocked(flowIo.importProjectFile).mockResolvedValueOnce({
      cancelled: true,
      missingModels: [],
      flowName: '',
      repaired: { droppedEdges: 0, detachedParents: 0 },
    })
    value.load.mockClear()
    value.status.mockClear()
    await importProjectFlow(value)
    expect(value.load).not.toHaveBeenCalled()
    expect(value.status).not.toHaveBeenCalled()
  })

  it('导入失败保留原错误文案、error 语气并在 finally 解锁', async () => {
    const { value, state } = createPorts()
    vi.mocked(flowIo.importProjectFile).mockRejectedValueOnce(new Error('bad json'))
    await importProjectFlow(value)
    expect(value.status).toHaveBeenCalledWith({ text: '导入失败：bad json', tone: 'error' })
    expect(state.busy).toBe(false)
  })

  it('合法 JSON 拖放关提示、preventDefault、按原文件字段导入并统一收尾', async () => {
    const { value, state } = createPorts()
    const file = { name: 'drop.flow.json', size: 42, type: '' }
    const event = dropEvent(file)
    vi.mocked(flowIo.importProjectFromFile).mockResolvedValueOnce(imported)
    await dropProjectFlow(value, event)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(state.dragging).toBe(false)
    expect(flowIo.importProjectFromFile).toHaveBeenCalledWith(
      value.platform,
      value.repo,
      { name: 'drop.flow.json', size: 42, mime: 'application/json', blob: file },
    )
    expect(value.load).toHaveBeenCalledOnce()
    expect(value.status).toHaveBeenCalledWith({ text: '已导入「新项目」', tone: 'info' })
    expect(state.busy).toBe(false)
  })

  it('拖放导入失败与菜单导入共用失败文案', async () => {
    const { value, state } = createPorts()
    const event = dropEvent({ name: 'drop.flow.json', size: 2, type: 'application/json' })
    vi.mocked(flowIo.importProjectFromFile).mockRejectedValueOnce(new Error('format missing'))
    await dropProjectFlow(value, event)
    expect(value.status).toHaveBeenCalledWith({ text: '导入失败：format missing', tone: 'error' })
    expect(state.busy).toBe(false)
  })

  it('导出先关菜单，进度、默认成功与带素材成功文案均保持原样', async () => {
    const { value, state, calls } = createPorts()
    vi.mocked(flowIo.exportProject).mockImplementationOnce(async (_platform, _id, opts) => {
      opts.onProgress?.(1, 2)
      return { fileName: '项目.flow.json' }
    })
    await exportProjectFlow(value, 'p1', '项目', { embedAssets: true })
    expect(flowIo.exportProject).toHaveBeenCalledWith(value.platform, 'p1', {
      embedAssets: true,
      onProgress: expect.any(Function),
    })
    expect(calls[0]).toEqual(['setBusy', true])
    expect(calls[1]).toEqual(['closeMenu'])
    expect(value.status).toHaveBeenNthCalledWith(1, { text: '导出中 1/2…', tone: 'info' })
    expect(value.status).toHaveBeenNthCalledWith(2, {
      text: '已导出「项目」为 项目.flow.json（含素材）',
      tone: 'info',
    })
    expect(state.menuId).toBeNull()
    expect(state.busy).toBe(false)

    vi.mocked(flowIo.exportProject).mockResolvedValueOnce({ fileName: 'plain.flow.json' })
    value.status.mockClear()
    await exportProjectFlow(value, 'p2', '普通')
    expect(value.status).toHaveBeenCalledWith({
      text: '已导出「普通」为 plain.flow.json',
      tone: 'info',
    })
  })

  it('导出失败保留原错误文案、error 语气并在 finally 解锁', async () => {
    const { value, state } = createPorts()
    vi.mocked(flowIo.exportProject).mockRejectedValueOnce(new Error('disk full'))
    await exportProjectFlow(value, 'p1', '项目')
    expect(value.status).toHaveBeenCalledWith({ text: '导出失败：disk full', tone: 'error' })
    expect(state.busy).toBe(false)
  })
})
