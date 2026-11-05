import { describe, expect, it } from 'vitest'
import {
  isMiddlePointer,
  isPrimaryPointer,
  isTextEditingTarget,
  lightboxKeyAction,
  shouldCloseOnStageClick,
} from './lightboxKeyboard'

describe('Lightbox 键盘与手势规则', () => {
  it('Esc 只在非编辑态关闭；左右键只在查看态且有多图时切图', () => {
    const base = { mode: 'view' as const, hasGalleryNavigation: true, editingText: false }
    expect(lightboxKeyAction({ ...base, key: 'Escape' })).toEqual({ kind: 'close' })
    expect(lightboxKeyAction({ ...base, key: 'ArrowLeft' })).toEqual({ kind: 'navigate', delta: -1 })
    expect(lightboxKeyAction({ ...base, key: 'ArrowRight' })).toEqual({ kind: 'navigate', delta: 1 })
    expect(lightboxKeyAction({ ...base, key: 'Escape', editingText: true })).toEqual({ kind: 'ignore' })
    expect(lightboxKeyAction({ ...base, mode: 'rotate', key: 'ArrowLeft' })).toEqual({ kind: 'ignore' })
    expect(lightboxKeyAction({ ...base, hasGalleryNavigation: false, key: 'ArrowLeft' })).toEqual({ kind: 'ignore' })
  })

  it('编辑模式和拖过一段都不按空白单击关闭', () => {
    expect(shouldCloseOnStageClick({ cropping: false, mode: 'view', moved: false })).toBe(true)
    expect(shouldCloseOnStageClick({ cropping: false, mode: 'view', moved: true })).toBe(false)
    expect(shouldCloseOnStageClick({ cropping: true, mode: 'crop', moved: false })).toBe(false)
    expect(shouldCloseOnStageClick({ cropping: false, mode: 'rotate', moved: false })).toBe(false)
  })

  it('左右键与中键的分工不让文本框抢按键', () => {
    expect(isPrimaryPointer(0)).toBe(true)
    expect(isMiddlePointer(1)).toBe(true)
    expect(isTextEditingTarget({ tagName: 'TEXTAREA' })).toBe(true)
    expect(isTextEditingTarget({ isContentEditable: true })).toBe(true)
    expect(isTextEditingTarget({ tagName: 'DIV' })).toBe(false)
  })
})
