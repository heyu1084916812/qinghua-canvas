import { describe, expect, it } from 'vitest'
import { ANNOTATE_TOOLS, EDITOR_MODES, HANDLE_POS } from './lightboxCatalog'
import { GalleryThumb } from './LightboxGalleryThumb'

describe('Lightbox 静态目录与画廊缩略图', () => {
  it('模式条七个入口与旧渲染顺序一致', () => {
    expect(EDITOR_MODES.map((item) => item.id)).toEqual([
      'view',
      'extract',
      'crop',
      'face',
      'annotate',
      'rotate',
      'compare',
    ])
    expect(ANNOTATE_TOOLS.map((item) => item.id)).toEqual(['brush', 'rect', 'text'])
  })

  it('八个裁剪手柄仍按各自方向定位', () => {
    expect(Object.keys(HANDLE_POS)).toHaveLength(8)
    expect(HANDLE_POS.nw.cursor).toBe('nwse-resize')
    expect(HANDLE_POS.e.left).toBe('100%')
    expect(HANDLE_POS.w.top).toBe('50%')
  })

  it('画廊缩略图作为独立局部组件导出', () => {
    expect(GalleryThumb).toBeTypeOf('function')
  })
})
