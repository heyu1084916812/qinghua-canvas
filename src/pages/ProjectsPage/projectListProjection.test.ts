import { describe, expect, it } from 'vitest'
import type { ProjectListItem } from '../../domain/project/project'
import {
  PROJECT_KIND_ORDER,
  projectCardMeta,
  projectKindCounts,
  projectsForKind,
} from './projectListProjection'

function project(id: string, workbench: ProjectListItem['workbench'], nodeCount = 0): ProjectListItem {
  return {
    id,
    name: id,
    workbench,
    createdAt: 1,
    updatedAt: 1,
    nodeCount,
  }
}

describe('projectListProjection', () => {
  const visible = [
    project('c1', 'canvas', 3),
    project('c2', 'canvas', 1),
    project('e1', 'ecommerce', 9),
  ]

  it('四个筛选档顺序与计数保持稳定，全部档不丢项目', () => {
    expect(PROJECT_KIND_ORDER.map((kind) => kind.id)).toEqual([
      'all',
      'canvas',
      'ecommerce',
      'storyboard',
    ])
    expect(projectKindCounts(visible)).toEqual([
      { id: 'all', label: '全部', count: 3 },
      { id: 'canvas', label: '画布', count: 2 },
      { id: 'ecommerce', label: '电商', count: 1 },
      { id: 'storyboard', label: '漫剧', count: 0 },
    ])
    expect(projectsForKind(visible, 'all').map((item) => item.id)).toEqual([
      'c1',
      'c2',
      'e1',
    ])
  })

  it('按工作台过滤返回新数组，不改写 store 的 visible 快照', () => {
    const canvas = projectsForKind(visible, 'canvas')
    expect(canvas.map((item) => item.id)).toEqual(['c1', 'c2'])
    expect(canvas).not.toBe(visible)
    expect(visible).toHaveLength(3)
  })

  it('卡片元信息只给画布项目附节点数', () => {
    expect(projectCardMeta(visible[0], '2 小时前')).toBe('2 小时前 · 3 个节点')
    expect(projectCardMeta(visible[2], '刚刚')).toBe('刚刚')
  })
})
