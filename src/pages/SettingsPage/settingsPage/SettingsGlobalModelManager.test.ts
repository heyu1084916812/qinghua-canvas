import { createElement } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import {
  SettingsGlobalModelManager,
  type SettingsGlobalModelManagerProps,
} from './SettingsGlobalModelManager'

const builtin = { id: 'Builtin Chat', category: 'chat', vendor: 'openai' } as const
const custom = {
  id: 'My Chat',
  label: 'My Chat Renamed',
  category: 'chat',
  vendor: 'openai',
} as const

function props(
  overrides: Partial<SettingsGlobalModelManagerProps> = {},
): SettingsGlobalModelManagerProps {
  return {
    open: true,
    groups: [
      {
        category: 'chat',
        label: '对话',
        models: [builtin, custom],
      },
    ],
    activeCategory: 'chat',
    customModels: [{ id: custom.id }],
    formOpen: false,
    newModelName: '',
    newModelCategory: 'image',
    newModelVendor: 'openai',
    onClose: vi.fn(),
    onFormOpenChange: vi.fn(),
    onNewModelNameChange: vi.fn(),
    onNewModelCategoryChange: vi.fn(),
    onNewModelVendorChange: vi.fn(),
    onAddGlobalModel: vi.fn(),
    onRemoveGlobalModel: vi.fn(),
    onRenameGlobalModel: vi.fn(),
    ...overrides,
  }
}

function render(overrides: Partial<SettingsGlobalModelManagerProps> = {}) {
  const value = props(overrides)
  let root!: TestRenderer.ReactTestRenderer
  act(() => {
    root = TestRenderer.create(createElement(SettingsGlobalModelManager, value))
  })
  return { root, value }
}

describe('SettingsGlobalModelManager', () => {
  it('目录同时显示内置与自定义模型，只有自定义模型有删除入口', () => {
    const { root } = render()
    const builtinRow = root.root.findByProps({ 'data-global-model-row': builtin.id })
    const customRow = root.root.findByProps({ 'data-global-model-row': custom.id })

    expect(builtinRow.props['data-global-model-kind']).toBe('builtin')
    expect(customRow.props['data-global-model-kind']).toBe('custom')
    expect(customRow.findAllByType('button').some((node) => node.children.includes('My Chat Renamed'))).toBe(true)
    expect(builtinRow.findAllByProps({ 'data-global-model-remove': builtin.id })).toHaveLength(0)
    expect(customRow.findAllByProps({ 'data-global-model-remove': custom.id })).toHaveLength(1)
  })

  it('删除把目标自定义模型交给目录动作', () => {
    const onRemoveGlobalModel = vi.fn()
    const { root } = render({ onRemoveGlobalModel })
    const customRow = root.root.findByProps({ 'data-global-model-row': custom.id })

    act(() => {
      customRow
        .findByProps({ 'data-global-model-remove': custom.id })
        .props.onClick()
    })

    expect(onRemoveGlobalModel).toHaveBeenCalledWith(custom.id)
    expect(customRow.findAllByProps({ 'data-global-model-uncommon': custom.id })).toHaveLength(0)
  })

  it('双击自定义模型名称后原位编辑，失焦提交新显示名', () => {
    const onRenameGlobalModel = vi.fn()
    const { root } = render({ onRenameGlobalModel })
    const customRow = root.root.findByProps({ 'data-global-model-row': custom.id })

    act(() => {
      customRow
        .findByProps({ 'data-global-model-rename-trigger': custom.id })
        .props.onDoubleClick()
    })
    const input = customRow
      .findByProps({ 'data-global-model-rename-input': custom.id })
    act(() => {
      input.props.onChange({ target: { value: 'Renamed Again' } })
    })
    act(() => {
      input.props.onBlur()
    })

    expect(onRenameGlobalModel).toHaveBeenCalledWith(custom.id, 'Renamed Again')
  })

  it('模型分类按 tab 切换，只渲染当前分类', () => {
    const image = { id: 'Image Model', category: 'image', vendor: 'openai' } as const
    const { root } = render({
      groups: [
        { category: 'chat', label: '对话', models: [builtin, custom] },
        { category: 'image', label: '图片', models: [image] },
      ],
    })
    expect(root.root.findAllByProps({ 'data-global-model-group': 'chat' })).toHaveLength(1)
    expect(root.root.findAllByProps({ 'data-global-model-group': 'image' })).toHaveLength(0)

    act(() => {
      root.root
        .findByProps({ 'data-global-model-category-tab': 'image' })
        .props.onClick()
    })
    expect(root.root.findAllByProps({ 'data-global-model-group': 'image' })).toHaveLength(1)
    expect(root.root.findAllByProps({ 'data-global-model-group': 'chat' })).toHaveLength(0)
  })

  it('新增面板默认收起，展开时继承当前映射分类', () => {
    const onFormOpenChange = vi.fn()
    const onNewModelCategoryChange = vi.fn()
    const { root } = render({
      onFormOpenChange,
      onNewModelCategoryChange,
    })
    expect(root.root.findAllByProps({ 'data-global-model-form': true })).toHaveLength(0)
    act(() => {
      root.root
        .findByProps({ 'data-global-model-create-toggle': true })
        .props.onClick()
    })
    expect(onNewModelCategoryChange).toHaveBeenCalledWith('chat')
    expect(onFormOpenChange).toHaveBeenCalledWith(true)
  })
})
