import { describe, expect, it } from 'vitest'
import {
  contextMenuPoint,
  deleteSelectionCommands,
  isEditableKeyboardTarget,
  shouldRouteCancel,
  shouldRouteRun,
  shouldSelectNodeForMenu,
} from './flowSurfaceMenus'

describe('FlowSurface 菜单与删除决策', () => {
  it('右键坐标使用 surface 局部坐标并按落点分菜单', () => {
    expect(contextMenuPoint(110, 90, { x: 10, y: 20 }, 'n1')).toEqual({
      x: 100,
      y: 70,
      target: { kind: 'node', nodeId: 'n1' },
    })
    expect(contextMenuPoint(110, 90, { x: 10, y: 20 }, null).target).toEqual({ kind: 'canvas' })
  })

  it('只有未选中的节点才在右键时改选区', () => {
    expect(shouldSelectNodeForMenu(['a'], 'b')).toBe(true)
    expect(shouldSelectNodeForMenu(['a', 'b'], 'b')).toBe(false)
  })

  it('运行 / 取消事件分路，其它事件仍交给页面事件出口', () => {
    expect(shouldRouteRun({ type: 'requestRun' })).toBe(true)
    expect(shouldRouteCancel({ type: 'requestRunCancel' })).toBe(true)
    expect(shouldRouteRun({ type: 'updateData' })).toBe(false)
  })

  it('输入框与 contenteditable 不接管 Delete / Backspace', () => {
    expect(isEditableKeyboardTarget({ tagName: 'INPUT' })).toBe(true)
    expect(isEditableKeyboardTarget({ tagName: 'TEXTAREA' })).toBe(true)
    expect(isEditableKeyboardTarget({ isContentEditable: true })).toBe(true)
    expect(isEditableKeyboardTarget({ tagName: 'DIV' })).toBe(false)
  })

  it('删除选择先删线，有节点时再发节点删除命令', () => {
    expect(deleteSelectionCommands({ nodeIds: [], edgeIds: [] })).toBeNull()
  })
})
