import { describe, expect, it } from 'vitest'
import { defaultCliTools } from '../../../../domain/shared/cliTools'
import type { WorkflowEntry } from '../../../../domain/project/workflowParams'
import { buildSourceMenu, cliCapabilityText, cliProtocolOf, cliStatusText, filterGroups, type SourceMenuInput } from './sourceMenuModel'
import { workflowSourceRows } from './workflowPanelSources'

/**
 * 模型菜单「API · 工作流 · CLI」三个标签的数据（对账 #1133，设计稿 work/source-mock）。
 * 钉：标签顺序与计数、API 平铺去重（不按渠道分组）+ 搜索、工作流分「AI 应用 / 工作流」两组与副标题、
 * CLI 状态 / 能力置灰 / 网页版锁住、每行点了切成什么（`pick`）、末行设置入口。
 */
const FLOW: WorkflowEntry = {
  id: 'w1', title: '视频超分', provider: 'runninghub', fetchedAt: 0, kind: 'workflow',
  fields: [
    { id: '6::text', nodeId: '6', fieldName: 'text', type: 'text', label: '提示词', value: 'a', enabled: true, group: '', options: [], min: null, max: null, step: null, seed: false, required: false, mediaOrder: 0 },
    { id: '7::seed', nodeId: '7', fieldName: 'seed', type: 'number', label: '种子', value: '1', enabled: false, group: '', options: [], min: null, max: null, step: null, seed: true, required: false, mediaOrder: 0 },
  ],
}
const APP: WorkflowEntry = { id: 'a1', title: '风格迁移', provider: 'runninghub', fetchedAt: 0, kind: 'app', fields: [] }

function input(over: Partial<SourceMenuInput> = {}): SourceMenuInput {
  const tools = defaultCliTools()
  return {
    apiModels: [
      { name: 'GPT Image 2', channelId: 'ch-a', channelName: '渠道 A' },
      { name: 'Seedream 4', channelId: 'ch-b', channelName: '渠道 B' },
      { name: 'Flux Pro', channelId: 'ch-a', channelName: '渠道 A' },
      { name: '孤儿模型', channelId: '', channelName: '' },
    ],
    workflowRows: workflowSourceRows({
      channels: [
        { id: 'rh-cn', name: 'RH', protocol: 'runninghub-api', baseUrl: 'https://www.runninghub.cn', entries: [FLOW] },
        { id: 'rh-ai', name: 'RH 国际', protocol: 'runninghub-api', baseUrl: 'https://www.runninghub.ai', entries: [APP] },
      ],
    }),
    siteOf: (id) => (id === 'rh-ai' ? '国际站' : '国内站'),
    cli: { desktop: true, tools: tools.map((tool) => ({ tool, status: tool.id === 'gemini' ? 'missing' : 'ok' })) },
    wantedCategory: 'image',
    currentModel: '',
    currentInstance: 'default',
    ...over,
  }
}

describe('标签', () => {
  it('固定三枚 API · 工作流 · CLI，计数 = 各自行数', () => {
    const tabs = buildSourceMenu(input())
    expect(tabs.map((tab) => [tab.source, tab.label, tab.count])).toEqual([
      ['api', 'API', 4],
      ['workflow', '工作流', 2],
      ['cli', 'CLI', 3],
    ])
  })

  it('每个标签末行是自己的设置入口', () => {
    expect(buildSourceMenu(input()).map((tab) => tab.footer)).toEqual([
      { label: '渠道设置…', action: 'channels' },
      { label: '管理 AI 应用 / 工作流…', action: 'workflows' },
      { label: '本机 CLI 设置…', action: 'cli' },
    ])
  })

  it('空标签：计数 0、无分组，给一句话（菜单据此画「去设置」）', () => {
    const tabs = buildSourceMenu(input({ apiModels: [], workflowRows: [], cli: { desktop: true, tools: [] } }))
    for (const tab of tabs) {
      expect(tab.count).toBe(0)
      expect(tab.groups).toEqual([])
      expect(tab.empty.length).toBeGreaterThan(5)
    }
  })
})

describe('API 标签', () => {
  it('平铺、同名模型多渠道只出一行、不含渠道名；没有渠道提供的放末尾「未配置」；点了只写模型名', () => {
    const api = buildSourceMenu(input({
      apiModels: [
        { name: 'GPT Image 2', channelId: 'ch-a', channelName: '渠道 A' },
        { name: '孤儿模型', channelId: '', channelName: '' },
        { name: 'Seedream 4', channelId: 'ch-b', channelName: '渠道 B' },
        { name: 'GPT Image 2', channelId: 'ch-b', channelName: '渠道 B' },
        { name: 'Flux Pro', channelId: 'ch-a', channelName: '渠道 A' },
      ],
    }))[0]!
    expect(api.count).toBe(4)
    expect(api.groups.map((group) => [group.label, group.rows.map((row) => row.label)])).toEqual([
      ['', ['GPT Image 2', 'Seedream 4', 'Flux Pro']],
      ['未配置', ['孤儿模型']],
    ])
    expect(JSON.stringify(api.groups)).not.toMatch(/渠道 A|渠道 B|ch-a|ch-b/)
    const row = api.groups[0]!.rows[0]!
    expect(row.value).toBe('api::GPT Image 2')
    expect(row.pick).toEqual({ source: 'api', model: 'GPT Image 2', channelId: '' })
    expect(row.hint).toBe('')
    expect(api.groups[1]!.rows[0]!.hint).toBe('还没有渠道提供')
  })

  it('搜索：只按模型名，忽略大小写；空查询原样；没匹配的分组去掉', () => {
    const groups = buildSourceMenu(input())[0]!.groups
    expect(filterGroups(groups, '  ')).toEqual(groups)
    expect(filterGroups(groups, 'flux').flatMap((group) => group.rows.map((row) => row.label))).toEqual(['Flux Pro'])
    expect(filterGroups(groups, '渠道')).toEqual([])
    expect(filterGroups(groups, '不存在')).toEqual([])
  })
})

describe('工作流标签', () => {
  it('分「AI 应用 / 工作流」两组，副标题 站点 · 参数数 · 实例；AI 应用不写 24G', () => {
    const flow = buildSourceMenu(input())[1]!
    expect(flow.groups.map((group) => group.label)).toEqual(['AI 应用', '工作流'])
    const [app] = flow.groups[0]!.rows
    const [wf] = flow.groups[1]!.rows
    expect(app!.hint).toBe('国际站 · 0 个参数')
    /** 只数暴露（enabled）的字段 */
    expect(wf!.hint).toBe('国内站 · 1 个参数 · 24G')
    expect(app!.value).toBe('rh-ai::app:a1')
    expect(wf!.value).toBe('rh-cn::workflow:w1')
  })

  it('当前条目选了 48G：副标题跟着写 48G（别的条目仍是 24G）', () => {
    const flow = buildSourceMenu(input({ currentModel: 'workflow:w1', currentInstance: 'plus' }))[1]!
    expect(flow.groups[1]!.rows[0]!.hint).toBe('国内站 · 1 个参数 · 48G')
  })

  it('点了切成工作流来源，带上条目自己的默认提交体、实例回默认', () => {
    const wf = buildSourceMenu(input())[1]!.groups[1]!.rows[0]!
    expect(wf.pick).toEqual({
      source: 'workflow',
      model: 'workflow:w1',
      channelId: 'rh-cn',
      defaults: { workflowNodeInfoList: [{ nodeId: '6', fieldName: 'text', fieldValue: 'a' }], workflowInstance: 'default' },
    })
    const app = buildSourceMenu(input())[1]!.groups[0]!.rows[0]!
    /** M2：应用是 app:<id>，不是 workflow: */
    expect(app.pick.model).toBe('app:a1')
  })
})

describe('CLI 标签', () => {
  it('每个工具一行：状态点、副标题「本机账号额度 · 能力」、点了切成 cli:<tool>', () => {
    const cli = buildSourceMenu(input())[2]!
    const rows = cli.groups[0]!.rows
    expect(rows.map((row) => [row.label, row.status])).toEqual([
      ['Codex', 'ok'],
      ['即梦', 'ok'],
      ['Gemini', 'missing'],
    ].map(([label, status]) => [expect.stringContaining(label!), status]))
    const jimeng = rows.find((row) => row.value === 'cli::jimeng')!
    expect(jimeng.hint).toBe('本机账号额度 · 出图 / 出视频')
    expect(jimeng.pick).toEqual({ source: 'cli', model: 'cli:jimeng', channelId: 'cli:jimeng' })
    expect(jimeng.disabled).toBeUndefined()
  })

  it('工具报不出这个类别 → 那一行置灰并说明（生图节点里的 Codex）', () => {
    const codex = buildSourceMenu(input())[2]!.groups[0]!.rows.find((row) => row.value === 'cli::codex')!
    expect(codex.disabled).toBe(true)
    expect(codex.title).toMatch(/不能/)
    const chatCodex = buildSourceMenu(input({ wantedCategory: 'chat' }))[2]!.groups[0]!.rows.find((row) => row.value === 'cli::codex')!
    expect(chatCodex.disabled).toBeUndefined()
  })

  it('网页版：标签锁住并写明需要桌面版；桌面版不锁', () => {
    const web = buildSourceMenu(input({ cli: { desktop: false, tools: [] } }))[2]!
    expect(web.locked).toMatch(/桌面版/)
    expect(buildSourceMenu(input())[2]!.locked).toBeUndefined()
    /** 还没探测（菜单未打开过）也按锁住处理，绝不在网页版先放出可点的 CLI 行 */
    expect(buildSourceMenu(input({ cli: null }))[2]!.locked).toMatch(/桌面版/)
  })

  it('状态文案 / 能力文案 / 协议反查', () => {
    expect([cliStatusText('checking'), cliStatusText('ok'), cliStatusText('missing')]).toEqual(['检测中', '可用', '未检测到'])
    expect(cliCapabilityText(defaultCliTools().find((tool) => tool.id === 'codex')!)).toBe('对话')
    expect(cliProtocolOf('jimeng')).toBe('jimeng-cli')
    expect(cliProtocolOf('nope')).toBe('')
  })
})
