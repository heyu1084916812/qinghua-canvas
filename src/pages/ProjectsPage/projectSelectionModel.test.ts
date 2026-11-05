import { describe, expect, it } from 'vitest'
import type { ProjectListItem } from '../../domain/project/project'
import {
  TRASH_KEEP_DAYS,
  pruneTrashSelection,
  selectAllTrash,
  toggleTrashItem,
  toggleVisibleProjects,
  trashProjection,
} from './projectSelectionModel'

function project(id: string, deletedAt?: number): ProjectListItem {
  return {
    id,
    name: id,
    workbench: 'canvas',
    createdAt: 1,
    updatedAt: 1,
    nodeCount: 0,
    deletedAt,
  }
}

const DAY_MS = 86_400_000

describe('projectSelectionModel', () => {
  it('项目全选 / 取消全选只作用于当前可见 ID，保留不可见选择', () => {
    const selected = new Set(['hidden'])
    const visible = ['p1', 'p2']
    const all = toggleVisibleProjects(selected, visible)
    expect([...all].sort()).toEqual(['hidden', 'p1', 'p2'])
    const cleared = toggleVisibleProjects(all, visible)
    expect([...cleared]).toEqual(['hidden'])
    expect([...selected]).toEqual(['hidden'])
  })

  it('回收站 Shift 范围选择双向成立，普通点击只切目标', () => {
    const items = ['p1', 'p2', 'p3', 'p4'].map((id) => project(id))
    const first = toggleTrashItem(items, new Set(), null, 'p2', false)
    expect([...first.selected]).toEqual(['p2'])
    expect(first.anchor).toBe('p2')

    const range = toggleTrashItem(items, first.selected, first.anchor, 'p4', true)
    expect([...range.selected]).toEqual(['p2', 'p3', 'p4'])
    expect(range.anchor).toBe('p4')

    const reverse = toggleTrashItem(items, range.selected, range.anchor, 'p1', true)
    expect([...reverse.selected]).toEqual(['p1', 'p2', 'p3', 'p4'])

    const toggleOff = toggleTrashItem(items, reverse.selected, reverse.anchor, 'p3', false)
    expect([...toggleOff.selected]).toEqual(['p1', 'p2', 'p4'])
  })

  it('全选与刷新裁剪保留有效选择、不复活已消失项目', () => {
    const items = ['p1', 'p2', 'p3'].map((id) => project(id))
    expect(selectAllTrash(items)).toEqual({
      selected: new Set(['p1', 'p2', 'p3']),
      anchor: 'p1',
    })
    const unchanged = pruneTrashSelection(new Set(['p1', 'p2']), items)
    expect([...unchanged.selected]).toEqual(['p1', 'p2'])
    expect(unchanged.anchor).toBeNull()

    const pruned = pruneTrashSelection(
      new Set(['p1', 'p3', 'gone']),
      [project('p3')],
    )
    expect([...pruned.selected]).toEqual(['p3'])
    expect(pruned.anchor).toBe('p3')
  })

  it('仅严格超过 30 天的软删项目进入清理 ID 列表', () => {
    const now = 1_000 * DAY_MS
    const day = DAY_MS
    const items = [
      project('fresh', now - day),
      project('boundary', now - TRASH_KEEP_DAYS * day),
      project('old', now - (TRASH_KEEP_DAYS + 1) * day),
      project('no-time'),
    ]
    const projection = trashProjection(
      items,
      new Set(['fresh', 'old']),
      now,
    )
    expect(projection.oldIds).toEqual(['old'])
    expect(projection.oldCount).toBe(1)
    expect(projection.allSelected).toBe(false)
    expect(projection.selectedCount).toBe(2)
    expect(
      trashProjection(items, new Set(items.map((item) => item.id)), now)
        .allSelected,
    ).toBe(true)
    expect(trashProjection([], new Set(), now).allSelected).toBe(false)
  })
})
