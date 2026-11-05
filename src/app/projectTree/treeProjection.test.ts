import { describe, expect, it } from 'vitest'
import type { ProjectFolder, ProjectListItem } from '../../domain/project/project'
import { projectTreeProjection, toggleGroupId } from './treeProjection'

function project(id: string, overrides: Partial<ProjectListItem> = {}): ProjectListItem {
  return {
    id,
    name: id,
    workbench: 'canvas',
    createdAt: 1,
    updatedAt: 1,
    nodeCount: 0,
    ...overrides,
  }
}

function folder(id: string): ProjectFolder {
  return { id, name: id, createdAt: 1, updatedAt: 1 }
}

describe('projectTreeProjection', () => {
  it('置顶 / 文件夹 / 未归档共用同一份树投影，当前项目置顶到窗口', () => {
    const items = Array.from({ length: 7 }, (_, index) =>
      project(`p${index + 1}`, { updatedAt: 10 - index }),
    )
    const projection = projectTreeProjection(
      [
        ...items,
        project('pinned', { pinnedAt: 10 }),
        project('inside', { folderId: 'f1' }),
      ],
      [folder('f1')],
      'p7',
      new Set(),
    )

    expect(projection.tree.pinnedProjects.map((item) => item.id)).toEqual(['pinned'])
    expect(projection.tree.folders[0].projects.map((item) => item.id)).toEqual(['inside'])
    expect(projection.pinnedWindow.visible.map((item) => item.id)).toEqual(['pinned'])
    expect(projection.groupWindow(items, 'workbench:canvas').visible.map((item) => item.id)).toEqual([
      'p7',
      'p1',
      'p2',
      'p3',
      'p4',
    ])
    expect(projection.groupWindow(items, 'workbench:canvas').hidden).toBe(2)
    expect(projection.folderTotal('f1')).toBe(1)
  })

  it('展开组按 activeProjectId 排序展示全部，收起组沿用 5 条上限', () => {
    const items = Array.from({ length: 8 }, (_, index) => project(`p${index + 1}`))
    const expanded = projectTreeProjection(items, [], null, new Set(['workbench:canvas']))
    const window = expanded.groupWindow(items, 'workbench:canvas')

    expect(window.expanded).toBe(true)
    expect(window.visible).toHaveLength(8)
    expect(window.hidden).toBe(3)
  })

  it('折叠 ID 切换不修改原集合，重复切换可恢复', () => {
    const before = new Set(['pinned'])
    const after = toggleGroupId(before, 'pinned')
    expect([...before]).toEqual(['pinned'])
    expect([...after]).toEqual([])
    expect([...toggleGroupId(after, 'pinned')]).toEqual(['pinned'])
  })
})
