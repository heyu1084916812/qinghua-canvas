import { describe, expect, it } from 'vitest'
import * as FlowSurface from './FlowSurface'
import * as viewport from './flowSurfaceViewport'
import * as pointer from './flowSurfacePointer'
import * as menus from './flowSurfaceMenus'
import * as imports from './flowSurfaceImport'

describe('FlowSurface 公共导出快照', () => {
  it('旧入口只导出 FlowSurface 组件，外部调用零改动', () => {
    expect(Object.keys(FlowSurface)).toEqual(['FlowSurface'])
    expect(FlowSurface.FlowSurface).toBeTypeOf('function')
  })

  it('四个新模块都提供独立的行为入口', () => {
    expect(viewport.sameFlowViewport).toBeTypeOf('function')
    expect(pointer.pointerWorldPoint).toBeTypeOf('function')
    expect(menus.contextMenuPoint).toBeTypeOf('function')
    expect(imports.shouldAcceptDraggedFiles).toBeTypeOf('function')
  })
})
