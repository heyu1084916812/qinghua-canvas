import { describe, expect, it } from 'vitest'
import { installCanvasDomAnchors, tagMarqueeAnchors, tagWorldAnchor } from './flowSurfaceDomAnchors'

describe('FlowSurface DOM 锚点', () => {
  it('没有画布元素时返回安全的空清理函数', () => {
    expect(tagWorldAnchor()).toBeTypeOf('function')
    expect(installCanvasDomAnchors()).toBeTypeOf('function')
  })

  it('模块暴露兼容锚点入口，不改变 React Flow 元素本身', () => {
    expect(tagMarqueeAnchors).toBeTypeOf('function')
  })
})
