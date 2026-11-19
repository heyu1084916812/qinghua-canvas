import { describe, expect, it } from 'vitest'
import { revealFolderTab } from './folderTabVisibility'

describe('revealFolderTab', () => {
  it.each([
    { name: '末枚加粗或出现优先级后完整露出', scroll: 0, x: 300, width: 120, expected: 70 },
    { name: '向左包含选中形状外扩的轮廓', scroll: 100, x: 105, width: 120, expected: 93 },
    { name: '首枚贴卡片左缘', scroll: 70, x: 0, width: 120, expected: 0 },
    { name: '已完整可见时不移动', scroll: 30, x: 60, width: 120, expected: 30 },
  ])('$name，保持纵向位置', ({ scroll, x, width, expected }) => {
    const host = { scrollLeft: scroll, clientWidth: 350, scrollTop: 93 } as HTMLElement
    const tab = { offsetLeft: x, offsetWidth: width } as HTMLElement
    revealFolderTab(host, tab)
    expect(host.scrollLeft).toBe(expected)
    expect(host.scrollTop).toBe(93)
  })
})
