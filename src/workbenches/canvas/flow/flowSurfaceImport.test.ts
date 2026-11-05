import { describe, expect, it } from 'vitest'
import { importFeedback, shouldAcceptDraggedFiles, shouldPasteMediaFiles } from './flowSurfaceImport'

describe('FlowSurface 导入规则', () => {
  it('dragover 只认 Files 类型，不能要求此刻给出文件列表', () => {
    expect(shouldAcceptDraggedFiles(['Files'])).toBe(true)
    expect(shouldAcceptDraggedFiles(['text/plain'])).toBe(false)
    expect(shouldAcceptDraggedFiles([])).toBe(false)
  })

  it('系统剪贴板无媒体或焦点在编辑器时放行，不抢文字粘贴', () => {
    expect(shouldPasteMediaFiles({ files: [new File(['x'], 'a.png')], editableTarget: false })).toBe(true)
    expect(shouldPasteMediaFiles({ files: [], editableTarget: false })).toBe(false)
    expect(shouldPasteMediaFiles({ files: [new File(['x'], 'a.png')], editableTarget: true })).toBe(false)
  })

  it('导入反馈区分拒绝数与成功数', () => {
    expect(importFeedback(2, 1)).toBe('跳过 1 个文件：只支持图片 / 视频素材')
    expect(importFeedback(2, 0)).toBe('已导入 2 个素材')
    expect(importFeedback(0, 0)).toBeNull()
  })
})
