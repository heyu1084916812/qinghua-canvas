import { describe, expect, it } from 'vitest'
import * as LightboxLayer from './LightboxLayer'
import * as viewportMath from './lightboxViewportMath'
import * as keyboard from './lightboxKeyboard'
import * as gallery from './lightboxGallery'
import * as editState from './lightboxEditState'

describe('LightboxLayer 公共导出快照', () => {
  it('旧入口只导出 LightboxLayer 组件，外部调用零改动', () => {
    expect(Object.keys(LightboxLayer)).toEqual(['LightboxLayer'])
    expect(LightboxLayer.LightboxLayer).toBeTypeOf('function')
  })

  it('四个新模块都提供独立的行为入口', () => {
    expect(viewportMath.wheelZoom).toBeTypeOf('function')
    expect(keyboard.lightboxKeyAction).toBeTypeOf('function')
    expect(gallery.galleryViewOf).toBeTypeOf('function')
    expect(editState.compareViewOf).toBeTypeOf('function')
  })
})
