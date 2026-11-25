import type { GraphSnapshot } from '../../../domain/canvas/model/graph'
import type { NodeSnapshot } from '../../../domain/canvas/model/node'
import { toWorldRectInGraph } from '../../../domain/canvas/geometry/coords'
import { assetNodeSize } from '../../../domain/canvas/layout/assetNodeSize'
import { fingerprintBytes } from '../../../domain/shared/hash'
import { createId } from '../../../shared/id'
import type { CanvasStore } from '../../../state/workbenches/canvas/store'
import type { Command } from '../../../state/commands'

/**
 * 把「旋转 + 镜像」**真画进像素**并创建派生节点（一步撤销）。
 *
 * 从 `RotateLayer` 里搬出来的（2026-10-16）：旋转现在住在**灯箱**里，
 * 而这段「把结果算出来 + 落成新素材 + 创建副本与连线 + 节点框跟着新比例走」
 * 与 UI 无关 —— 留在组件里会让灯箱那侧再抄一份，迟早漂移（这个仓库的老毛病）。
 */
export interface RotateSaveInput {
  store: CanvasStore
  graph: GraphSnapshot
  node: NodeSnapshot
  /** 原图的 url（`useAssetMeta` 给的那份） */
  url: string
  angle: number
  mirrorH: boolean
  mirrorV: boolean
}

export interface RotatedResultCommandsInput {
  graph: GraphSnapshot
  node: NodeSnapshot
  newId: string
  newHash: string
  bytes: Uint8Array
  width: number
  height: number
  createdAt: number
}

/** The whole rotation result is one undoable plan and never mutates the source node. */
export function rotatedResultCommands(
  input: RotatedResultCommandsInput,
): Command[] {
  const { graph, node, newId, newHash, bytes, width, height, createdAt } = input
  const rect = toWorldRectInGraph(node, graph)
  const size = assetNodeSize({ width, height })
  const copyX = rect.x + node.w + 40
  return [
    {
      kind: 'asset.put',
      asset: {
        hash: newHash,
        mime: 'image/png',
        bytes,
        width,
        height,
        createdAt,
        projectId: graph.projectId,
      },
    },
    {
      kind: 'node.duplicate',
      ids: [node.id],
      newIds: [newId],
      dx: node.w + 40,
      dy: 0,
      rewire: false,
    },
    {
      kind: 'edge.connect',
      source: node.id,
      target: newId,
      sourcePort: 'output',
      targetPort: 'input',
    },
    {
      kind: 'node.updateData',
      id: newId,
      patch: {
        assetHash: newHash,
        naturalSize: { width, height },
        thumbOrder: [newHash],
      },
    },
    {
      kind: 'node.resize',
      id: newId,
      rect: {
        x: copyX + (rect.w - size.w) / 2,
        y: rect.y + (rect.h - size.h) / 2,
        w: size.w,
        h: size.h,
      },
      phase: 'end',
    },
  ]
}

export async function saveRotatedAsset(input: RotateSaveInput): Promise<void> {
  const { store, graph, node, url, angle, mirrorH, mirrorV } = input

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error('load'))
    el.src = url
  })

  const rad = (angle * Math.PI) / 180
  const cos = Math.abs(Math.cos(rad))
  const sin = Math.abs(Math.sin(rad))
  const w = Math.max(1, Math.round(img.naturalWidth * cos + img.naturalHeight * sin))
  const h = Math.max(1, Math.round(img.naturalWidth * sin + img.naturalHeight * cos))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const g2 = canvas.getContext('2d')
  if (!g2) return
  g2.translate(w / 2, h / 2)
  g2.rotate(rad)
  g2.scale(mirrorH ? -1 : 1, mirrorV ? -1 : 1)
  g2.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2)

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) return
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const newHash = await fingerprintBytes(bytes)

  /** 字节与哈希都算完了才开事务（plan 之间不得 await） */
  const newId = createId('node')
  const commands = rotatedResultCommands({
    graph,
    node,
    newId,
    newHash,
    bytes,
    width: w,
    height: h,
    createdAt: Date.now(),
  })
  store.beginPlan(`rotate-save:${node.id}`, '保存旋转结果')
  for (const command of commands) store.dispatch(command)
  store.endPlan()
  store.setSelection([newId])
  await store.flush()
  store.showUndoBar('已保存旋转结果')
}
