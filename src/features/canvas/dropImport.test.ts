import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryPlatform } from '../../platform/memory'
import { registerAllSpecs, resetSpecs } from '../../domain/canvas/nodeSpecs'
import { createCanvasStore } from '../../state/workbenches/canvas/store'
import type { PlatformKit } from '../../platform/ports'
import {
  clipboardMediaFiles,
  draggedFiles,
  draggedReferenceId,
  dropReferenceToCanvas,
  hasDraggedFiles,
  hasDraggedReference,
  REFERENCE_DRAG_MIME,
  setReferenceDragData,
} from './dropImport'

/**
 * 这一组钉的是「**怎么判断这是不是一次文件拖拽**」这条判据本身。
 *
 * 背景（对账 #551）：`onDragOver` 曾用「文件列表长不长」判断，而 `dragover` 阶段
 * 浏览器**不给** `dataTransfer.files`（安全限制，恒为空）⇒ 那一支直接 return、
 * 不 `preventDefault` ⇒ 浏览器认定这里不接收 ⇒ **`drop` 永不派发**。
 * 用户看到的是「从软件外面拖不进来」，而合成事件的冒烟全绿。
 * 所以判据只能是 `types.includes('Files')`，这条测试把这个形状固定下来。
 */

/** 造一个只有 `types` / `files` / `items` 的最小 dataTransfer 替身（node 环境没有 DataTransfer） */
function dt(opts: {
  types?: string[]
  files?: File[]
  items?: { kind: string; type: string; file: File | null }[]
}): { dataTransfer: DataTransfer } {
  const types = [...(opts.types ?? [])]
  const data = new Map<string, string>()
  const dataTransfer = {
    types,
    files: opts.files ?? [],
    items: (opts.items ?? []).map((i) => ({ ...i, getAsFile: () => i.file })),
    effectAllowed: 'none',
    setData(type: string, value: string) {
      if (!types.includes(type)) types.push(type)
      data.set(type, value)
    },
    getData(type: string) {
      return data.get(type) ?? ''
    },
  } as unknown as DataTransfer
  return { dataTransfer }
}

describe('拖放判据（dragover 与 drop 两阶段的形状不同）', () => {
  it('★★★ dragover 阶段：files 为空但 types 含 Files，仍必须认成文件拖拽', () => {
    const dragging = dt({ types: ['Files'], files: [] })
    expect(hasDraggedFiles(dragging)).toBe(true)
    /** 这正是当年误判的形状：用 files 判断会得到"不是文件" */
    expect(draggedFiles(dragging)).toEqual([])
  })

  it('★ 画布内的节点拖拽（没有 Files 类型）不算文件拖拽', () => {
    const nodeDrag = dt({ types: ['text/plain'], files: [] })
    expect(hasDraggedFiles(nodeDrag)).toBe(false)
    expect(draggedFiles(nodeDrag)).toEqual([])
  })

  it('drop 阶段：files 里真有文件时才取出来', () => {
    const dropped = new File([new Uint8Array([1, 2])], 'a.png', { type: 'image/png' })
    expect(draggedFiles(dt({ types: ['Files'], files: [dropped] }))).toEqual([dropped])
  })

  it('项目参考使用独立 MIME，不能被误判成系统文件', () => {
    const dragging = dt({})
    setReferenceDragData(dragging.dataTransfer, 'ref-1')
    expect(hasDraggedReference(dragging)).toBe(true)
    expect(hasDraggedFiles(dragging)).toBe(false)
    expect(draggedReferenceId(dragging)).toBe('ref-1')
    expect(dragging.dataTransfer.types).toContain(REFERENCE_DRAG_MIME)
  })
})

describe('项目参考落到画布', () => {
  let platform: PlatformKit

  beforeEach(() => {
    resetSpecs()
    registerAllSpecs()
    platform = createMemoryPlatform()
  })

  it('回查资产元数据后建素材节点，按落点居中并选中', async () => {
    const store = createCanvasStore({ platform, projectId: 'p-ref-drop' })
    await platform.storage.put('assets', {
      id: 'asset-1',
      mime: 'image/png',
      width: 320,
      height: 240,
      bytes: new Uint8Array([1, 2, 3]),
    })
    await platform.storage.put('referenceItems', {
      id: 'ref-1',
      projectId: 'p-ref-drop',
      title: '方形参考',
      source: 'file',
      kind: 'image',
      assetHash: 'asset-1',
      what: '用户上传的图片参考',
      createdAt: 1,
      updatedAt: 1,
    })

    const outcome = await dropReferenceToCanvas(
      { platform, store, projectId: 'p-ref-drop' },
      'ref-1',
      { x: 500, y: 300 },
    )

    expect(outcome).toMatchObject({ ok: true, title: '方形参考' })
    if (!outcome.ok) throw new Error(outcome.reason)
    const node = store.getSnapshot().nodes.find((row) => row.id === outcome.nodeId)!
    expect(node.title).toBe('方形参考')
    expect(node.data).toMatchObject({ assetHash: 'asset-1', assetMime: 'image/png' })
    expect(Math.abs(node.x + node.w / 2 - 500)).toBeLessThanOrEqual(1)
    expect(Math.abs(node.y + node.h / 2 - 300)).toBeLessThanOrEqual(1)
    expect(store.getSelection()).toEqual([outcome.nodeId])
  })

  it('资产已被清理时拒绝建空节点', async () => {
    const store = createCanvasStore({ platform, projectId: 'p-ref-drop' })
    await platform.storage.put('referenceItems', {
      id: 'ref-missing',
      projectId: 'p-ref-drop',
      title: '丢失的参考',
      source: 'file',
      kind: 'image',
      assetHash: 'missing',
      what: '用户上传的图片参考',
      createdAt: 1,
      updatedAt: 1,
    })

    const outcome = await dropReferenceToCanvas(
      { platform, store, projectId: 'p-ref-drop' },
      'ref-missing',
      { x: 100, y: 100 },
    )

    expect(outcome).toEqual({ ok: false, reason: '参考素材内容不存在或格式已损坏' })
    expect(store.getSnapshot().nodes).toEqual([])
  })
})

describe('系统剪贴板里的媒体文件', () => {
  const png = (name = 'shot.png', bytes = [1, 2, 3]): File =>
    new File([new Uint8Array(bytes)], name, { type: 'image/png' })

  it('★ 取到图片文件', () => {
    const shot = png()
    expect(clipboardMediaFiles(dt({ files: [shot] }).dataTransfer)).toEqual([shot])
  })

  it('★★ 剪贴板里没有媒体 → 空数组（调用方据此放行默认粘贴，不吞粘文字）', () => {
    const text = new File([new Uint8Array([1])], 'a.txt', { type: 'text/plain' })
    expect(clipboardMediaFiles(dt({ files: [text] }).dataTransfer)).toEqual([])
    expect(clipboardMediaFiles(null)).toEqual([])
  })

  it('★ 有些来源只挂在 items 上（kind: file）', () => {
    const shot = png('from-items.png')
    const data = dt({ files: [], items: [{ kind: 'file', type: 'image/png', file: shot }] })
    expect(clipboardMediaFiles(data.dataTransfer)).toEqual([shot])
  })

  it('★ files 与 items 各报一遍同一个文件时按身份去重', () => {
    const shot = png('same.png')
    const data = dt({ files: [shot], items: [{ kind: 'file', type: 'image/png', file: shot }] })
    expect(clipboardMediaFiles(data.dataTransfer)).toHaveLength(1)
  })

  /**
   * ★★★ 真实浏览器的形状：`files` 与 `items` 各报一遍**同一个文件**，
   * 但两边的 `lastModified` **差 1 毫秒**（2026-10-17 实测 `…163` / `…164`）。
   *
   * 按元数据去重拦不住这个 —— 用户看到的就是「复制一张图粘进画布出来两张」
   * （对账 #552）。判据因此改成：**有 `files` 就不看 `items`**。
   */
  it('★★★ files 与 items 打同一个文件、lastModified 差 1ms → 仍然只算一个', () => {
    const bytes = new Uint8Array([1, 2, 3])
    const fromFiles = new File([bytes], 'image.png', {
      type: 'image/png',
      lastModified: 1_000,
    })
    const fromItems = new File([bytes], 'image.png', {
      type: 'image/png',
      lastModified: 1_001,
    })
    const data = dt({ files: [fromFiles], items: [{ kind: 'file', type: 'image/png', file: fromItems }] })
    const got = clipboardMediaFiles(data.dataTransfer)
    expect(got).toHaveLength(1)
    /** 取的是 `files` 那一份（`items` 只在 files 为空时才是来源） */
    expect(got[0]).toBe(fromFiles)
  })
})
