import { describe, expect, it } from 'vitest'
import { SettingsChannelOverlays } from './SettingsChannelOverlays'

const SIBLING_SOURCES = import.meta.glob('./*.tsx', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>
const PAGE_SOURCES = import.meta.glob('../SettingsPage.tsx', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

const sourceOf = (path: string) => SIBLING_SOURCES[path]
const OVERLAYS_SOURCE = sourceOf('./SettingsChannelOverlays.tsx')
const PAGE_SOURCE = PAGE_SOURCES['../SettingsPage.tsx']

/**
 * 这两块浮层靠 portal 挂到 `document.body`，而本项目 Vitest 是 **node 环境**
 * （没有 jsdom，`window` 根本不存在），所以不在单测里渲染——真实行为由冒烟
 * `g74` 覆盖（点齿轮开资料抽屉、右键出菜单、编辑与删除）。这里守的是**结构**：
 * 浮层只在这一个模块里 portal，页面不再自己 `createPortal`。
 */
describe('渠道页两块 portal 浮层', () => {
  it('导出装配组件，两块浮层都在这里 portal 到 body', () => {
    expect(SettingsChannelOverlays).toBeTypeOf('function')
    expect(OVERLAYS_SOURCE.match(/createPortal\(/g) ?? []).toHaveLength(2)
    expect(OVERLAYS_SOURCE).toContain('SettingsProfileDrawerView')
    expect(OVERLAYS_SOURCE).toContain('SettingsChannelContextMenuView')
    expect(OVERLAYS_SOURCE).toContain('channelMenuPresentationFor')
  })

  it('页面不再直接 portal，只挂这一枚浮层组件', () => {
    expect(PAGE_SOURCE).toContain('<SettingsChannelOverlays')
    expect(PAGE_SOURCE).not.toContain('createPortal')
    expect(PAGE_SOURCE).not.toContain('channelMenuPresentationFor')
  })

  it('两块浮层各自保留自己的 DOM 锚点（冒烟按它们取元素）', () => {
    const drawer = sourceOf('./SettingsProfileDrawerView.tsx')
    const menu = sourceOf('./SettingsChannelContextMenuView.tsx')
    expect(drawer).toContain('data-settings-profile-drawer')
    expect(menu).toContain('data-channel-context-menu')
  })
})
