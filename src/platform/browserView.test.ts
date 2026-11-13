import { describe, expect, it } from 'vitest'
import {
  CANVAS_BROWSER_VIEW_ID,
  isBrowserViewId,
  roundBrowserViewBounds,
  sameBrowserViewBounds,
} from './browserView'

describe('browserView 端口工具', () => {
  it('视图 id 与 Rust 侧同一套规则', () => {
    expect(isBrowserViewId(CANVAS_BROWSER_VIEW_ID)).toBe(true)
    expect(isBrowserViewId('agent-1')).toBe(true)
    expect(isBrowserViewId('')).toBe(false)
    expect(isBrowserViewId('Main')).toBe(false)
    expect(isBrowserViewId('a/b')).toBe(false)
    expect(isBrowserViewId('a'.repeat(33))).toBe(false)
  })

  it('坐标按边取整，宽高不为负', () => {
    expect(roundBrowserViewBounds({ x: 0.5, y: 1.4, width: 10.2, height: 5.5 }))
      .toEqual({ x: 1, y: 1, width: 10, height: 6 })
    expect(roundBrowserViewBounds({ x: 5, y: 5, width: -3, height: -1 }))
      .toEqual({ x: 5, y: 5, width: 0, height: 0 })
  })

  it('sameBrowserViewBounds 只在四个值都相等时为真', () => {
    const a = { x: 1, y: 2, width: 3, height: 4 }
    expect(sameBrowserViewBounds(null, a)).toBe(false)
    expect(sameBrowserViewBounds({ ...a }, a)).toBe(true)
    expect(sameBrowserViewBounds({ ...a, width: 5 }, a)).toBe(false)
  })
})
