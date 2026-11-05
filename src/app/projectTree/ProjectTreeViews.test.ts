import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  GroupExpandButton,
  MenuButton,
  ProjectDeleteConfirmActions,
} from './ProjectTreeViews'

describe('ProjectTreeViews', () => {
  it('删除确认动作保持按钮顺序、禁用态和忙碌文案', () => {
    const html = renderToStaticMarkup(
      createElement(ProjectDeleteConfirmActions, {
        deleting: true,
        onCancel: vi.fn(),
        onConfirm: vi.fn(),
      }),
    )
    expect(html).toContain('data-project-tree-confirm-delete')
    expect(html).toContain('收尾中…')
    expect(html.match(/disabled=""/g)).toHaveLength(2)
    expect(html.indexOf('取消')).toBeLessThan(html.indexOf('收尾中…'))
  })

  it('展开按钮保留 data 锚点、aria-expanded 和计数文案', () => {
    expect(
      renderToStaticMarkup(
        createElement(GroupExpandButton, {
          count: 3,
          expanded: false,
          groupId: 'workbench:canvas',
          onToggle: vi.fn(),
        }),
      ),
    ).toContain('data-project-tree-expand="workbench:canvas"')
    expect(
      renderToStaticMarkup(
        createElement(GroupExpandButton, {
          count: 3,
          expanded: true,
          groupId: 'pinned',
          onToggle: vi.fn(),
        }),
      ),
    ).toContain('aria-expanded="true"')
  })

  it('菜单项保留 role、trailing 与危险态类名映射', () => {
    const html = renderToStaticMarkup(
      createElement(MenuButton, {
        icon: 'i',
        label: '删除',
        trailing: '›',
        danger: true,
        disabled: true,
        onClick: vi.fn(),
      }),
    )
    expect(html).toContain('role="menuitem"')
    expect(html).toContain('disabled=""')
    expect(html).toContain('›')
    expect(html).toContain('menuItemDanger')
  })
})
