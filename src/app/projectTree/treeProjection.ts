import type { ProjectFolder, ProjectListItem } from '../../domain/project/project'
import { type ProjectTreeModel, buildProjectTree, projectGroupWindow } from '../projectTreeModel'

export interface ProjectTreeGroupWindow {
  visible: ProjectListItem[]
  hidden: number
  expanded: boolean
}

export interface ProjectTreeProjection {
  tree: ProjectTreeModel
  pinnedWindow: ProjectTreeGroupWindow
  groupWindow(items: readonly ProjectListItem[], groupId: string): ProjectTreeGroupWindow
  folderTotal(folderId: string): number
}

/**
 * Builds the read-only projection consumed by the sidebar rows.
 *
 * It owns no project state: the repository snapshot and the local expanded/collapsed
 * sets remain with the ProjectTree component.
 */
export function projectTreeProjection(
  projects: readonly ProjectListItem[],
  folders: readonly ProjectFolder[],
  activeProjectId: string | null,
  expandedGroups: ReadonlySet<string>,
): ProjectTreeProjection {
  const tree = buildProjectTree(projects, folders)
  const windowFor = (items: readonly ProjectListItem[], groupId: string) => {
    const expanded = expandedGroups.has(groupId)
    const grouped = projectGroupWindow(items, activeProjectId, expanded)
    return { ...grouped, expanded }
  }
  return {
    tree,
    pinnedWindow: windowFor(tree.pinnedProjects, 'pinned'),
    groupWindow: windowFor,
    folderTotal: (folderId) =>
      projects.filter((project) => project.folderId === folderId).length,
  }
}

export function toggleGroupId(
  current: ReadonlySet<string>,
  groupId: string,
): Set<string> {
  const next = new Set(current)
  if (next.has(groupId)) next.delete(groupId)
  else next.add(groupId)
  return next
}
