import { describe, expect, it } from 'vitest'
import { BROWSER_OCCLUDER_SELECTOR, findBrowserOccluder, rectsOverlap } from './browserOcclusion'

const rect = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom })

describe('原生视图遮挡判定', () => {
  const content = rect(100, 100, 500, 400)

  it('rectsOverlap 只把真正相交算作重叠（贴边不算）', () => {
    expect(rectsOverlap(content, rect(450, 350, 600, 500))).toBe(true)
    expect(rectsOverlap(content, rect(500, 100, 600, 400))).toBe(false)
    expect(rectsOverlap(content, rect(0, 0, 100, 100))).toBe(false)
  })

  it('跳过浏览器自己的浮层、零尺寸元素和不相交的浮层', () => {
    expect(findBrowserOccluder(content, [
      { node: 'own', rect: rect(120, 120, 200, 200), insideOwnRoot: true },
      { node: 'hidden', rect: rect(120, 120, 120, 200), insideOwnRoot: false },
      { node: 'far', rect: rect(600, 0, 700, 50), insideOwnRoot: false },
    ])).toBeNull()
  })

  it('返回第一个压在内容区上的浮层', () => {
    expect(findBrowserOccluder(content, [
      { node: 'far', rect: rect(600, 0, 700, 50), insideOwnRoot: false },
      { node: 'menu', rect: rect(480, 380, 640, 520), insideOwnRoot: false },
      { node: 'dialog', rect: rect(0, 0, 1440, 900), insideOwnRoot: false },
    ])).toBe('menu')
  })

  it('选择器覆盖对话框、菜单、下拉和项目里的浮层锚点', () => {
    for (const token of ['role="dialog"', 'role="menu"', 'role="listbox"', 'data-context-menu', 'data-param-popup', 'data-browser-occluder']) {
      expect(BROWSER_OCCLUDER_SELECTOR).toContain(token)
    }
  })
})
