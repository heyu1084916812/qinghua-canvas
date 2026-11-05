import type { WorkbenchId } from '../../domain/shared/workbench'
import type { ProjectListItem } from '../../domain/project/project'

export type ProjectKind = 'all' | WorkbenchId

export interface ProjectKindOption {
  id: ProjectKind
  label: string
  count: number
}

export const PROJECT_KIND_ORDER: readonly { id: ProjectKind; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'canvas', label: '画布' },
  { id: 'ecommerce', label: '电商' },
  { id: 'storyboard', label: '漫剧' },
]

export function projectKindCounts(
  visible: readonly ProjectListItem[],
): readonly ProjectKindOption[] {
  return PROJECT_KIND_ORDER.map((kind) => ({
    ...kind,
    count:
      kind.id === 'all'
        ? visible.length
        : visible.filter((project) => project.workbench === kind.id).length,
  }))
}

export function projectsForKind(
  visible: readonly ProjectListItem[],
  kind: ProjectKind,
): ProjectListItem[] {
  return kind === 'all'
    ? [...visible]
    : visible.filter((project) => project.workbench === kind)
}

export function projectCardMeta(
  project: ProjectListItem,
  relativeTime: string,
): string {
  return `${relativeTime}${project.workbench === 'canvas' ? ` · ${project.nodeCount} 个节点` : ''}`
}
