import type { ProjectListItem } from '../../domain/project/project'
import {
  allVisibleProjectsSelected,
  clearVisibleProjects,
  selectVisibleProjects,
  toggleProjectSelection,
} from '../../domain/project/selection'

export const TRASH_KEEP_DAYS = 30
const DAY_MS = 86_400_000

export interface TrashSelectionWindow {
  selected: ReadonlySet<string>
  anchor: string | null
}

export interface TrashProjection {
  oldIds: readonly string[]
  oldCount: number
  allSelected: boolean
  selectedCount: number
}

export function toggleVisibleProjects(
  selected: ReadonlySet<string>,
  visibleIds: readonly string[],
): Set<string> {
  return allVisibleProjectsSelected(selected, visibleIds)
    ? clearVisibleProjects(selected, visibleIds)
    : selectVisibleProjects(selected, visibleIds)
}

export function toggleTrashItem(
  items: readonly ProjectListItem[],
  selected: ReadonlySet<string>,
  anchor: string | null,
  id: string,
  shift: boolean,
): TrashSelectionWindow {
  if (shift && anchor) {
    const from = items.findIndex((project) => project.id === anchor)
    const to = items.findIndex((project) => project.id === id)
    if (from >= 0 && to >= 0) {
      const [start, end] = from < to ? [from, to] : [to, from]
      return {
        selected: new Set(items.slice(start, end + 1).map((project) => project.id)),
        anchor: id,
      }
    }
  }
  return {
    selected: toggleProjectSelection(selected, id),
    anchor: id,
  }
}

export function selectAllTrash(items: readonly ProjectListItem[]): TrashSelectionWindow {
  return {
    selected: new Set(items.map((project) => project.id)),
    anchor: items[0]?.id ?? null,
  }
}

export function pruneTrashSelection(
  selected: ReadonlySet<string>,
  nextItems: readonly ProjectListItem[],
): { selected: ReadonlySet<string>; anchor: string | null } {
  const live = new Set(nextItems.map((project) => project.id))
  const kept = new Set([...selected].filter((id) => live.has(id)))
  return kept.size === selected.size
    ? { selected, anchor: null }
    : {
        selected: kept,
        anchor: [...kept][0] ?? null,
      }
}

export function trashProjection(
  items: readonly ProjectListItem[],
  selected: ReadonlySet<string>,
  now: number,
): TrashProjection {
  const oldIds = items
    .filter(
      (project) =>
        typeof project.deletedAt === 'number' &&
        project.deletedAt < now - TRASH_KEEP_DAYS * DAY_MS,
    )
    .map((project) => project.id)
  return {
    oldIds,
    oldCount: oldIds.length,
    allSelected:
      items.length > 0 &&
      items.every((project) => selected.has(project.id)),
    selectedCount: selected.size,
  }
}
