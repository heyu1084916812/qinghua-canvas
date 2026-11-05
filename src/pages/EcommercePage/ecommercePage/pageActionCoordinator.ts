import type { EcommerceCanvasItem } from '../../../domain/ecommerce/canvasItem'
import type { EcommerceResultRecord, EcommerceTaskRecord } from '../../../domain/ecommerce/tasks'
import type { EcommerceGenerationStage } from '../../../domain/ecommerce/progress'
import type { EcommerceWorkbenchAction } from '../EcommerceWorkbench'
import { downloadAsset as downloadAssetImpl } from '../../../features/shared/assets/downloadAsset'
import { workbenchActionTargetOf } from './pageResultProjection'

export interface EcommerceActionPorts {
  projectId: string
  workbenchResults: readonly EcommerceResultRecord[]
  resultRows: readonly EcommerceResultRecord[]
  activeTask: EcommerceTaskRecord | null
  platform: {
    assets: { read(hash: string): Promise<{ mime?: string; bytes: { length: number } } | null> }
    files: unknown
  }
  assetLibraryRepo: {
    save(row: {
      hash: string
      mime: string
      bytes: number
      width?: number
      height?: number
      savedAt: number
      projectId: string
      prompt?: string
      model?: string
      ratio?: string
    }): Promise<unknown>
  }
  retryWorkbenchResult(resultId: string): Promise<void> | void
  downloadAsset?: typeof downloadAssetImpl
  setGenerationStage(stage: EcommerceGenerationStage): void
}

/** One deterministic workbench action target; callers provide the current React state and persistence ports. */
export function workbenchActionOf(ports: EcommerceActionPorts) {
  return (item: EcommerceCanvasItem, action: EcommerceWorkbenchAction): void => {
    const target = workbenchActionTargetOf({
      item,
      action,
      workbenchResults: ports.workbenchResults,
      resultRows: ports.resultRows,
    })
    const row = target.row
    if (action === 'retry') {
      if (row) void ports.retryWorkbenchResult(row.id)
      return
    }
    const hash = target.hash
    if (!hash) return
    if (action === 'download') {
      void (ports.downloadAsset ?? downloadAssetImpl)(
        { assets: ports.platform.assets, files: ports.platform.files } as never,
        hash,
      )
      return
    }
    if (action === 'save') {
      void (async () => {
        const payload = await ports.platform.assets.read(hash)
        await ports.assetLibraryRepo.save({
          hash,
          mime: payload?.mime ?? row?.mime ??
            (item.kind === 'video' ? 'video/mp4' : 'image/png'),
          bytes: payload?.bytes.length ?? 0,
          ...(row?.width !== undefined ? { width: row.width } : { width: item.width }),
          ...(row?.height !== undefined ? { height: row.height } : { height: item.height }),
          savedAt: Date.now(),
          projectId: ports.projectId,
          ...(row?.prompt ? { prompt: row.prompt } : {}),
          ...(row?.model ? { model: row.model } : {}),
        })
      })()
        .then(() => ports.setGenerationStage({ phase: 'done', label: '已收藏到素材库' }))
        .catch((error: unknown) => ports.setGenerationStage({
          phase: 'failed',
          label: '收藏失败',
          detail: error instanceof Error ? error.message : String(error),
        }))
    }
  }
}
