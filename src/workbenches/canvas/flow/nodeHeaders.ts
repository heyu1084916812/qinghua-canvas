import type { NodeSnapshot } from '../../../domain/canvas/model/node'
import type { Rect } from '../../../domain/canvas/geometry/rect'
import { assetPixelsOf, formatPixels } from '../frame/assetPixels'
import {
  containerScale,
  packContainerChildren,
} from '../../../domain/canvas/layout/packContainer'

export const NODE_HEADER_HEIGHT = 22
export const NODE_HEADER_GAP = 2
export const NODE_HEADER_SIDE_INSET = 8

export interface NodeHeaderLabel {
  id: string
  title: string
  pixels: string
  x: number
  y: number
  w: number
}

export function nodeHeaderLabels(nodes: readonly NodeSnapshot[]): NodeHeaderLabel[] {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const children = new Map<string, NodeSnapshot[]>()
  for (const node of nodes) {
    if (!node.parentId) continue
    const list = children.get(node.parentId) ?? []
    list.push(node)
    children.set(node.parentId, list)
  }
  const batchRects = new Map<string, { x: number; y: number; w: number }>()
  for (const parent of nodes) {
    if (parent.type !== 'batch') continue
    const ordered = orderedChildren(children.get(parent.id) ?? [], parent)
    const packs = packContainerChildren(ordered.length)
    const scale = containerScale('batch', ordered.length, { w: parent.w, h: parent.h })
    ordered.forEach((child, index) => {
      const cell = packs.positions[index]
      if (!cell) return
      batchRects.set(child.id, {
        x: parent.x + cell.x * scale,
        y: parent.y + cell.y * scale,
        w: packs.cellSize.w * scale,
      })
    })
  }

  return nodes.map((node) => {
    const pixels = assetPixelsOf(node)
    const parent = node.parentId ? byId.get(node.parentId) : null
    const batchRect = batchRects.get(node.id)
    const rect = batchRect
      ? batchRect
      : parent?.type === 'group'
        ? { x: parent.x + node.x, y: parent.y + node.y, w: node.w }
        : node.parentId
          ? { x: node.x, y: node.y, w: node.w }
          : { x: node.x, y: node.y, w: node.w }
    return {
      id: node.id,
      title: node.title,
      pixels: pixels ? formatPixels(pixels) : '',
      ...rect,
    }
  })
}

function orderedChildren(children: readonly NodeSnapshot[], parent: NodeSnapshot): NodeSnapshot[] {
  const childIds = (parent.data as { childIds?: string[] }).childIds ?? []
  const byId = new Map(children.map((child) => [child.id, child]))
  const ordered: NodeSnapshot[] = []
  for (const id of childIds) {
    const child = byId.get(id)
    if (child) {
      ordered.push(child)
      byId.delete(id)
    }
  }
  for (const child of children) if (byId.has(child.id)) ordered.push(child)
  return ordered
}

export function nodeHeadersInView(
  labels: readonly NodeHeaderLabel[],
  viewport: { x: number; y: number; zoom: number },
  surface: { w: number; h: number },
): NodeHeaderLabel[] {
  const zoom = Math.max(viewport.zoom || 1, 0.01)
  const left = viewport.x - NODE_HEADER_SIDE_INSET
  const top = viewport.y - NODE_HEADER_HEIGHT - NODE_HEADER_GAP
  const right = viewport.x + surface.w / zoom + NODE_HEADER_SIDE_INSET
  const bottom = viewport.y + surface.h / zoom
  return labels.filter((label) => {
    const labelRight = label.x + label.w + NODE_HEADER_SIDE_INSET
    const labelBottom = label.y
    return labelRight >= left && label.x - NODE_HEADER_SIDE_INSET <= right && labelBottom >= top && label.y <= bottom
  })
}

export function headerLabelIds(labels: readonly NodeHeaderLabel[]): string[] {
  return labels.map((label) => label.id)
}

export function sameHeaderLabels(
  previous: readonly NodeHeaderLabel[],
  next: readonly NodeHeaderLabel[],
): boolean {
  if (previous.length !== next.length) return false
  for (let index = 0; index < previous.length; index += 1) {
    const left = previous[index]
    const right = next[index]
    if (
      left.id !== right.id ||
      left.title !== right.title ||
      left.pixels !== right.pixels ||
      left.x !== right.x ||
      left.y !== right.y ||
      left.w !== right.w
    ) {
      return false
    }
  }
  return true
}

export function nodeHeaderRect(label: NodeHeaderLabel): Rect {
  return {
    x: label.x - NODE_HEADER_SIDE_INSET,
    y: label.y - NODE_HEADER_HEIGHT - NODE_HEADER_GAP,
    w: label.w + NODE_HEADER_SIDE_INSET * 2,
    h: NODE_HEADER_HEIGHT,
  }
}
