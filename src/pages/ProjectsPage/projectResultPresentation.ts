import type { ImportResult } from '../../state/project/flowIo'
import type { NoticeTone } from '../../domain/ui/notice'

export interface ProjectNotice {
  text: string
  tone: NoticeTone
}

export function importResultNotice(result: ImportResult): ProjectNotice | null {
  if (result.cancelled) return null
  const notes: string[] = []
  if (result.missingModels.length) {
    notes.push(`${result.missingModels.length} 个节点引用了本机没有的模型`)
  }
  if (result.repaired.detachedParents) {
    notes.push(`${result.repaired.detachedParents} 个节点的归属已失效、已放回画布根层`)
  }
  if (result.repaired.droppedEdges) {
    notes.push(`${result.repaired.droppedEdges} 条连线指向不存在的节点、已清掉`)
  }
  return {
    text: `已导入「${result.project?.name}」${notes.length ? `（${notes.join('；')}）` : ''}`,
    tone: 'info',
  }
}

export function projectFailureNotice(prefix: string, error: unknown): ProjectNotice {
  return {
    text: `${prefix}：${error instanceof Error ? error.message : String(error)}`,
    tone: 'error',
  }
}

export function deletionNotice(count: number): ProjectNotice {
  return { text: `已删除 ${count} 个项目`, tone: 'info' }
}

export function trashRestoreNotice(restored: number, failed: number): ProjectNotice {
  return failed === 0
    ? { text: `已还原 ${restored} 个项目`, tone: 'info' }
    : {
        text: `已还原 ${restored} 个，${failed} 个失败并保留选择`,
        tone: 'error',
      }
}

export function projectCleanupNotice(): ProjectNotice {
  return { text: '项目运行态清理完成', tone: 'info' }
}
