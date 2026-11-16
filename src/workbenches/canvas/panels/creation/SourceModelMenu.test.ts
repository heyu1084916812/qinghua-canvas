import { createElement } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { defaultCliTools } from '../../../../domain/shared/cliTools'
import { SourceModelMenu, type SourceModelMenuProps } from './SourceModelMenu'
import { buildSourceMenu } from './sourceMenuModel'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
/** ParamPicker 的定位 / 点外关闭要 window / document：给最小桩（node 环境，无 jsdom） */
beforeAll(() => {
  vi.stubGlobal('window', { innerHeight: 900, innerWidth: 1440 })
  vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} })
})
afterAll(() => vi.unstubAllGlobals())

/**
 * 模型菜单交互（对账 #1133）：**只切标签不改节点、点了一行才切**；打开时停在节点当前来源；
 * 网页版 CLI 锁住；空标签一句话 + 去设置；chip 前有来源角标。
 */
const rect = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 }
const fakeNode = () => ({
  getBoundingClientRect: () => rect,
  closest: () => null,
  querySelector: () => null,
  contains: () => false,
  scrollTo: () => {},
  offsetHeight: 0,
  offsetWidth: 0,
  offsetTop: 0,
  scrollTop: 0,
  style: {},
})

function tabs(desktop = true, empty = false) {
  return buildSourceMenu({
    apiModels: empty ? [] : [{ name: 'GPT Image 2', channelId: 'ch-a', channelName: '渠道 A' }],
    workflowRows: [],
    siteOf: () => '国内站',
    cli: { desktop, tools: defaultCliTools().map((tool) => ({ tool, status: 'ok' as const })) },
    wantedCategory: 'image',
    currentModel: '',
    currentInstance: 'default',
  })
}

function mount(over: Partial<SourceModelMenuProps> = {}) {
  const onPick = vi.fn()
  const onFooter = vi.fn()
  const onClose = vi.fn()
  const props: SourceModelMenuProps = {
    tabs: tabs(),
    source: 'api',
    selected: { api: 'api::GPT Image 2' },
    label: 'GPT Image 2',
    iconFor: () => null,
    open: true,
    onToggle: () => {},
    onClose,
    onPick,
    onFooter,
    ...over,
  }
  let renderer!: TestRenderer.ReactTestRenderer
  act(() => {
    renderer = TestRenderer.create(createElement(SourceModelMenu, props), { createNodeMock: fakeNode })
  })
  const find = (attr: string, value?: string) =>
    renderer.root.findAll((node) => typeof node.type === 'string' && node.props[attr] !== undefined && (value === undefined || node.props[attr] === value))
  return { renderer, find, onPick, onFooter, onClose }
}

describe('模型菜单（内嵌来源切换）', () => {
  it('打开时停在节点当前来源；标签带计数', () => {
    const { find } = mount({ source: 'cli', selected: { cli: 'cli::jimeng' } })
    expect(find('data-source-menu')[0]!.props['data-source-menu']).toBe('cli')
    const on = find('data-source-tab').filter((node) => node.props['aria-selected'])
    expect(on.map((node) => node.props['data-source-tab'])).toEqual(['cli'])
  })

  it('★ 只切标签不改节点：点 CLI 标签不发 onPick；点了一行才发', () => {
    const { find, onPick, onClose } = mount()
    act(() => find('data-source-tab', 'cli')[0]!.props.onClick())
    expect(onPick).not.toHaveBeenCalled()
    expect(find('data-source-menu')[0]!.props['data-source-menu']).toBe('cli')
    act(() => find('data-source-option', 'cli::jimeng')[0]!.props.onClick())
    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onPick.mock.calls[0]![0].pick).toEqual({ source: 'cli', model: 'cli:jimeng', channelId: 'cli:jimeng' })
    expect(onClose).toHaveBeenCalled()
  })

  it('API 标签有搜索；没匹配时说一句', () => {
    const { find } = mount()
    act(() => find('data-source-search')[0]!.props.onChange({ target: { value: 'zzz' } }))
    expect(find('data-source-empty', 'search')).toHaveLength(1)
  })

  it('网页版：CLI 标签置灰锁住并给原因', () => {
    const { find } = mount({ tabs: tabs(false) })
    const cli = find('data-source-tab', 'cli')[0]!
    expect(cli.props.disabled).toBe(true)
    expect(cli.props.title).toMatch(/桌面版/)
  })

  it('空标签：一句话 + 去设置（走该标签的设置入口）', () => {
    const { find, onFooter } = mount({ tabs: tabs(true, true), selected: {} })
    expect(find('data-source-empty', 'api')).toHaveLength(1)
    act(() => find('data-source-empty-go', 'channels')[0]!.props.onClick())
    expect(onFooter).toHaveBeenCalledWith('channels')
  })

  it('chip 前有当前来源角标', () => {
    const { find } = mount({ source: 'workflow', open: false })
    expect(find('data-source-badge', 'workflow')).toHaveLength(1)
  })
})
