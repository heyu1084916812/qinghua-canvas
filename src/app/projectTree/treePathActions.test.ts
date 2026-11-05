import { describe, expect, it, vi } from 'vitest'
import type { ProjectFolder, ProjectListItem } from '../../domain/project/project'
import {
  createProjectTreePathActions,
  joinProjectPath,
  projectLocalDirectory,
  projectSafeFileName,
} from './treePathActions'

function project(id: string, overrides: Partial<ProjectListItem> = {}): ProjectListItem {
  return {
    id,
    name: `项目:${id}`,
    workbench: 'canvas',
    createdAt: 1,
    updatedAt: 1,
    nodeCount: 0,
    folderId: null,
    ...overrides,
  }
}

function folder(id: string): ProjectFolder {
  return { id, name: `目录/${id}`, createdAt: 1, updatedAt: 1 }
}

function harness(overrides: Record<string, unknown> = {}) {
  const clipboard = { writeText: vi.fn(async () => undefined) }
  const openDir = vi.fn(async () => undefined)
  const upload = vi.fn(async () => ({ url: 'https://example.test/project.json' }))
  const exportProject = vi.fn(async (_platform: unknown, id: string) => ({
    blob: new Blob([id]),
    fileName: `${id}.flow.json`,
  }))
  const platform = {
    assetFolder: { path: () => 'C:\\轻画\\assets' },
    storageAdmin: { dataDir: () => 'C:\\轻画\\data', openDir },
    hosting: { upload },
    ...overrides,
  }
  const onStatus = vi.fn()
  const actions = createProjectTreePathActions({
    platform: platform as never,
    clipboard,
    exportProject: exportProject as never,
    onStatus,
  })
  return { actions, clipboard, openDir, upload, exportProject, onStatus }
}

describe('projectTreePathActions pure helpers', () => {
  it('保留 Windows / POSIX 分隔符并清理文件名', () => {
    expect(joinProjectPath('C:\\data\\', '目录', '项目.flow.json')).toBe(
      'C:\\data\\目录\\项目.flow.json',
    )
    expect(joinProjectPath('/data/', '目录', '项目.flow.json')).toBe(
      '/data/目录/项目.flow.json',
    )
    expect(projectSafeFileName('  画/布:项*目  ')).toBe('画_布_项_目')
    expect(projectSafeFileName('   ')).toBe('未命名项目')
  })

  it('优先素材文件夹，其次存储管理目录', async () => {
    const assetFolder = { path: () => 'C:\\assets' }
    const storageAdmin = { dataDir: () => 'C:\\data' }
    await expect(projectLocalDirectory({ assetFolder } as never)).resolves.toBe('C:\\assets')
    await expect(projectLocalDirectory({ storageAdmin } as never)).resolves.toBe('C:\\data')
    await expect(projectLocalDirectory({} as never)).resolves.toBeNull()
  })
})

describe('projectTreePathActions', () => {
  it('复制项目 / 文件夹路径使用同一目录与安全文件名', async () => {
    const { actions, clipboard } = harness()
    expect(await actions.copyProjectPath(project('p1'))).toEqual({
      text: '项目路径已复制',
      tone: 'info',
    })
    expect(await actions.copyFolderPath(folder('f1'))).toEqual({
      text: '文件夹路径已复制',
      tone: 'info',
    })
    expect(clipboard.writeText).toHaveBeenNthCalledWith(
      1,
      'C:\\轻画\\assets\\项目_p1.flow.json',
    )
    expect(clipboard.writeText).toHaveBeenNthCalledWith(
      2,
      'C:\\轻画\\assets\\目录_f1',
    )
  })

  it('浏览器无本地目录时如实提示，不调用剪贴板或资源管理器', async () => {
    const { actions, clipboard, openDir } = harness({
      assetFolder: undefined,
      storageAdmin: undefined,
    })
    expect(await actions.copyProjectPath(project('p1'))).toEqual({
      text: '本地路径仅在桌面应用可用',
      tone: 'error',
    })
    expect(await actions.revealProject()).toEqual({
      text: '资源管理器仅在桌面应用可用',
      tone: 'error',
    })
    expect(clipboard.writeText).not.toHaveBeenCalled()
    expect(openDir).not.toHaveBeenCalled()
  })

  it('上传项目按打包、上传、复制直链顺序播报', async () => {
    const { actions, clipboard, exportProject, upload, onStatus } = harness()
    const result = await actions.uploadProject(project('p1'))
    expect(result).toEqual({ text: '项目已上传，公网直链已复制', tone: 'info' })
    expect(exportProject).toHaveBeenCalledOnce()
    expect(upload).toHaveBeenCalledOnce()
    expect(clipboard.writeText).toHaveBeenCalledWith(
      'https://example.test/project.json',
    )
    expect(onStatus.mock.calls.map(([status]) => status.text)).toEqual([
      '正在打包「项目:p1」…',
      '正在上传到 OSS…',
    ])
  })

  it('上传文件夹逐项命名，未配置 OSS 时保留已完成数量语义', async () => {
    const inside = [
      project('p1', { folderId: 'f1' }),
      project('p2', { folderId: 'f1' }),
      project('outside', { folderId: null }),
    ]
    const { actions, upload, onStatus } = harness()
    expect(await actions.uploadFolder(folder('f1'), inside)).toEqual({
      text: '文件夹已上传 2/2 个项目',
      tone: 'info',
    })
    expect(upload.mock.calls.map((call) => (call as unknown as [{ name: string }])[0].name)).toEqual([
      '目录_f1-p1.flow.json',
      '目录_f1-p2.flow.json',
    ])
    expect(onStatus.mock.calls.map(([status]) => status.text)).toEqual([
      '正在上传 1/2：项目:p1',
      '正在上传 2/2：项目:p2',
    ])

    const empty = harness()
    expect(await empty.actions.uploadFolder(folder('empty'), [])).toEqual({
      text: '这个文件夹里没有可上传的项目',
      tone: 'info',
    })
  })

  it('上传失败保留真实错误与前缀', async () => {
    const { actions } = harness({
      hosting: { upload: vi.fn(async () => null) },
    })
    expect(await actions.uploadProject(project('p1'))).toEqual({
      text: '素材传输还没有配置，先到全局设置 → 素材传输选择 OSS',
      tone: 'error',
    })

    const failing = harness()
    failing.exportProject.mockRejectedValueOnce(new Error('打包磁盘满'))
    expect(await failing.actions.uploadProject(project('p1'))).toEqual({
      text: '上传失败：打包磁盘满',
      tone: 'error',
    })
  })
})
