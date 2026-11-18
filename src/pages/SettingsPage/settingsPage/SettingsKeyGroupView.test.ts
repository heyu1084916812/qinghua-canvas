import { createElement } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { ChannelCredentialGroup } from '../../../domain/project/channel'
import { SettingsKeyGroupView } from './SettingsKeyGroupView'
import { SettingsKeyGroupMenuView } from './SettingsKeyGroupMenuView'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const fakeEvent = () =>
  ({
    preventDefault: () => {},
    stopPropagation: () => {},
    clientX: 40,
    clientY: 80,
  }) as never

const primary = {
  id: 'primary',
  name: '主分组',
  credentialRef: 'credential-primary',
  tokenTail: '1234',
  hasToken: true,
  priority: 10,
  models: [],
  modelCache: [],
  modelMap: {},
  createdAt: 1,
} as unknown as ChannelCredentialGroup

const backup = {
  ...primary,
  id: 'backup',
  name: '备用分组',
  hasToken: false,
  tokenTail: null,
  priority: 0,
} as unknown as ChannelCredentialGroup

function mount(overrides: Partial<Parameters<typeof SettingsKeyGroupView>[0]> = {}) {
  const props = {
    activeGroup: primary,
    selectedKeyGroups: [primary, backup],
    busy: false,
    onAddKeyGroup: vi.fn(async () => {}),
    onRemoveKeyGroup: vi.fn(async () => {}),
    onActiveGroupChange: vi.fn(),
    onRenameKeyGroup: vi.fn(),
    onSetKeyGroupPriority: vi.fn(),
    ...overrides,
  }
  let renderer!: TestRenderer.ReactTestRenderer
  act(() => {
    renderer = TestRenderer.create(createElement(SettingsKeyGroupView, props), {
      createNodeMock: () => ({
        querySelector: () => null,
        scrollIntoView: () => {},
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
        scrollLeft: 0,
        style: {},
        setAttribute: () => {},
        getAttribute: () => null,
      }),
    })
  })
  return { renderer, props }
}

describe('SettingsKeyGroupView 文件夹标签', () => {
  it('点击其他标题切换分组', () => {
    const { renderer, props } = mount()
    const backupTab = renderer.root.findByProps({ 'data-key-group-tab': 'backup' })
    act(() => {
      backupTab.props.onClick()
    })
    expect(props.onActiveGroupChange).toHaveBeenCalledWith('backup')
  })

  it('标签保持分组原有顺序（切换靠形变层滑过去，不重排）', () => {
    const { renderer } = mount({ activeGroup: backup })
    const order = renderer.root
      .findAll((node) => typeof node.props['data-key-group-tab'] === 'string')
      .map((node) => node.props['data-key-group-tab'] as string)
    expect(order).toEqual(['primary', 'backup'])
    expect(renderer.root.findByProps({ 'data-key-group-tab': 'backup' }).props['aria-selected']).toBe(
      true,
    )
  })

  it('双击标题进入改名，失焦后按新名字回写', () => {
    const { renderer, props } = mount()
    const activeTab = renderer.root.findByProps({ 'data-key-group-tab': 'primary' })
    act(() => {
      activeTab.props.onDoubleClick(fakeEvent())
    })
    const input = renderer.root.findByProps({ 'data-key-group-name': true })
    expect(input.props.value).toBe('主分组')
    act(() => {
      input.props.onChange({ target: { value: '主力 Key' } })
    })
    act(() => {
      renderer.root.findByProps({ 'data-key-group-name': true }).props.onBlur()
    })
    expect(props.onRenameKeyGroup).toHaveBeenCalledWith('primary', '主力 Key')
    expect(renderer.root.findAllByProps({ 'data-key-group-name': true })).toHaveLength(0)
  })

  it('标题里没有状态点、编辑与删除按钮', () => {
    const { renderer } = mount()
    const tab = renderer.root.findByProps({ 'data-key-group-editor': 'primary' })
    const buttons = tab.findAllByType('button')
    /* 只剩优先级那一枚；重命名/删除都搬进右键菜单 */
    expect(buttons).toHaveLength(1)
    expect(buttons[0].props.title).toBe('修改分组优先级')
  })

  it('双击还没选中的标题：先切组，再把输入框留在新标题上', () => {
    const { renderer, props } = mount()
    act(() => {
      renderer.root.findByProps({ 'data-key-group-tab': 'backup' }).props.onDoubleClick(fakeEvent())
    })
    expect(props.onActiveGroupChange).toHaveBeenCalledWith('backup')
    act(() => {
      renderer.update(createElement(SettingsKeyGroupView, { ...props, activeGroup: backup }))
    })
    expect(renderer.root.findByProps({ 'data-key-group-name': true }).props.value).toBe('备用分组')
  })

  it('右键菜单只有编辑与删除：唯一一组时删除不可点，确认态换文案', () => {
    const renderMenu = (overrides: Partial<Parameters<typeof SettingsKeyGroupMenuView>[0]>) =>
      renderToStaticMarkup(
        createElement(SettingsKeyGroupMenuView, {
          menuRef: { current: null },
          name: '主分组',
          left: 10,
          top: 20,
          confirm: false,
          busy: false,
          canDelete: true,
          onEdit: () => {},
          onRequestDelete: () => {},
          onConfirmDelete: () => {},
          onCancelDelete: () => {},
          ...overrides,
        }),
      )

    const menu = renderMenu({})
    expect(menu).toContain('data-key-group-menu-rename')
    expect(menu).toContain('编辑')
    expect(menu).toContain('data-key-group-menu-delete')
    expect(menu).toContain('删除分组')
    expect(menu).not.toContain('disabled')

    expect(renderMenu({ canDelete: false })).toContain('disabled')

    const confirm = renderMenu({ confirm: true })
    expect(confirm).toContain('删除「主分组」？该组 Key 一并删除')
    expect(confirm).toContain('data-key-group-menu-delete-confirm')
    expect(confirm).toContain('data-key-group-menu-delete-cancel')
  })
})
