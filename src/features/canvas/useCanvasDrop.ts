import { useCallback, type DragEvent } from 'react'
import type { Point } from '../../domain/canvas/geometry/rect'
import { screenToWorld } from '../../domain/canvas/geometry/coords'
import type { PlatformKit } from '../../platform/ports'
import type { CanvasStore } from '../../state/workbenches/canvas/store'
import {
  draggedFiles,
  draggedReferenceId,
  dropReferenceToCanvas,
  hasDraggedFiles,
  hasDraggedReference,
} from './dropImport'

export function hasCanvasDrop(e: { dataTransfer: DataTransfer }): boolean {
  return hasDraggedFiles(e) || hasDraggedReference(e)
}

/** 画布拖放唯一入口：系统媒体走既有导入链，项目参考走 assets hash 回查。 */
export function useCanvasDrop(input: {
  platform: PlatformKit
  store: CanvasStore
  projectId: string
  importFiles: (files: readonly File[], world: Point) => Promise<void>
  setImportHover: (hover: boolean) => void
}): (event: DragEvent<HTMLDivElement>) => Promise<void> {
  const { platform, store, projectId, importFiles, setImportHover } = input
  return useCallback(async (event) => {
    const files = draggedFiles(event)
    const referenceId = draggedReferenceId(event)
    const hasReference = hasDraggedReference(event)
    if (files.length === 0 && !hasReference) return

    event.preventDefault()
    setImportHover(false)
    const rect = event.currentTarget.getBoundingClientRect()
    const world = screenToWorld(
      { x: event.clientX, y: event.clientY },
      store.getViewport(),
      { x: rect.left, y: rect.top, w: rect.width, h: rect.height },
    )
    if (!hasReference) {
      await importFiles(files, world)
      return
    }
    if (!referenceId) {
      store.notify('参考卡片缺少标识，无法放到画布', 'error')
      return
    }
    try {
      const outcome = await dropReferenceToCanvas({ platform, store, projectId }, referenceId, world)
      store.notify(
        outcome.ok ? `已把「${outcome.title}」放到画布` : outcome.reason,
        outcome.ok ? undefined : 'error',
      )
    } catch (error) {
      store.notify(
        `放到画布失败：${error instanceof Error ? error.message : '未知错误'}`,
        'error',
      )
    }
  }, [importFiles, platform, projectId, setImportHover, store])
}
