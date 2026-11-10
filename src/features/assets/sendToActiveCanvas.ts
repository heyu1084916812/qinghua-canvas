import type { LibraryAsset } from '../../domain/shared/assetLibrary'
import { assetNodeSize } from '../../domain/canvas/layout/assetNodeSize'
import { findFreeRect } from '../../domain/agent/landing'
import type { PlatformKit } from '../../platform/ports'
import { createAssetNode } from '../canvas/importAsset'
import { activeCanvasId } from '../../state/project/activeCanvas'
import { rememberCanvasCover } from '../../state/project/cover'
import { createStore } from '../../state/createStore'
import { canvasStoreFor } from '../../state/workbenches/canvas/storeCache'
import { broadcastWrite } from '../../app/session'

export class NoActiveCanvasError extends Error {
  constructor() {
    super('先打开一个画布，再发送素材')
    this.name = 'NoActiveCanvasError'
  }
}

export interface SendToActiveCanvasResult {
  projectId: string
  projectName: string
  nodeId: string
}

/**
 * 把素材复制成一个新的画布生成节点。
 *
 * 不借用画布页的 store 缓存：离开画布时那一个实例已经 dispose，且它可能正在
 * 执行别的写入。这里按项目新建一个短生命周期 store，水合、追加节点、flush、
 * dispose，语义与“导入一张图到画布”一致。
 */
export async function sendAssetToActiveCanvas(
  platform: PlatformKit,
  asset: LibraryAsset,
): Promise<SendToActiveCanvasResult> {
  const projectId = activeCanvasId()
  if (!projectId) throw new NoActiveCanvasError()

  await platform.storage.open()
  const [projectRows, assetRows] = await Promise.all([
    platform.storage.query(
      'projects',
      { id: projectId },
      { includePayload: false, fields: ['id', 'name'] },
    ),
    platform.storage.query(
      'assets',
      { id: asset.hash },
      { includePayload: false, fields: ['id', 'mime'] },
    ),
  ])
  const project = projectRows[0]
  if (!project) throw new Error('当前画布项目已经不存在')
  if (!assetRows[0]) throw new Error('素材内容不存在，可能已经被清理')

  /**
   * 必须复用本次会话里项目对应的 store。旧实现另建一个短生命周期 store，
   * 只把节点写进数据库；返回画布时缓存已标记 `hydrated`，不会再次水合，
   * 于是用户眼前看不到新图，必须整页刷新才出现。
   */
  const cached = canvasStoreFor(projectId, () =>
    createStore({ workbench: 'canvas', platform, projectId }),
  )
  const store = cached.store
  if (!cached.hydrated) {
    const [nodeRows, edgeRows] = await Promise.all([
      platform.storage.query('nodes', { projectId }),
      platform.storage.query('edges', { projectId }),
    ])
    store.hydrate({
      projectId,
      nodes: nodeRows as never,
      edges: edgeRows as never,
    })
    cached.hydrated = true
  }

  const nodes = store.getSnapshot().nodes
  const size = assetNodeSize({ width: asset.width, height: asset.height })
  const viewport = store.getViewport()
  const inset = 120 / Math.max(viewport.zoom, 0.01)
  const spot = findFreeRect(
    {
      ...size,
      x: viewport.x + inset,
      y: viewport.y + inset,
    },
    nodes.map((node) => ({
      x: node.x,
      y: node.y,
      w: node.w,
      h: node.h,
    })),
  )
  const nodeId = createAssetNode(
    { platform, store, projectId },
    {
      hash: asset.hash,
      mime: asset.mime,
      width: asset.width,
      height: asset.height,
      name: asset.prompt?.trim().slice(0, 24) || `素材-${asset.hash.slice(0, 6)}`,
    },
    { x: spot.x, y: spot.y },
  )
  if (!nodeId) {
    throw new Error('画布没有建立素材节点')
  }

  await store.flush()
  broadcastWrite(projectId)
  void rememberCanvasCover(platform.storage, projectId, asset.hash)
  return {
    projectId,
    projectName: String(project.name ?? '画布'),
    nodeId,
  }
}
