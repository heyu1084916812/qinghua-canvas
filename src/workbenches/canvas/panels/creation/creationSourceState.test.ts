import { describe, expect, it } from 'vitest'
import { generationSpec } from '../../../../domain/canvas/nodeSpecs/generation'
import type { GenerationData } from '../../../../domain/canvas/model/node'
import { defaultCliTools } from '../../../../domain/shared/cliTools'
import type { WorkflowEntry } from '../../../../domain/project/workflowParams'
import { cliToolIdOf, creationSourceState, type CreationSourceInput } from './creationSourceState'
import type { CliPanelSources } from './sourceMenuModel'
import type { WorkflowPanelSources } from './workflowPanelSources'

/**
 * 创作面板「当前来源」的纯决策（对账 #1133）。钉用户强调的几条逻辑：
 * - 节点归哪个来源（存了以存的为准；老节点按前缀 / 条目表 / 渠道协议推）；
 * - 每个标签勾「这个来源上次选的那一项」；
 * - 老节点只在**判得准**时补写来源；
 * - 运行前按来源拦截并给原因。
 */
const FLOW: WorkflowEntry = { id: 'w1', title: '超分', provider: 'runninghub', fetchedAt: 0, kind: 'workflow', fields: [] }
const APP: WorkflowEntry = { id: 'a1', title: '风格迁移', provider: 'runninghub', fetchedAt: 0, kind: 'app', fields: [] }
const SOURCES: WorkflowPanelSources = {
  channels: [{ id: 'rh', name: 'RH', protocol: 'runninghub-api', entries: [FLOW, APP] }],
  loaded: true,
}
const CHANNELS = [
  { id: 'ch-a', protocol: 'openai' },
  { id: 'rh', protocol: 'runninghub-api' },
  { id: 'ch-jimeng', protocol: 'jimeng-cli' },
]
const desktop = (status: 'ok' | 'missing' = 'ok'): CliPanelSources => ({
  desktop: true,
  tools: defaultCliTools().map((tool) => ({ tool, status })),
})

function data(over: Partial<GenerationData>): GenerationData {
  return { ...generationSpec.createDefaultData(), ...over }
}
function state(over: Partial<GenerationData>, input: Partial<CreationSourceInput> = {}) {
  return creationSourceState({
    data: data(over),
    workflowSources: SOURCES,
    channels: CHANNELS,
    cli: desktop(),
    wantedCategory: 'image',
    apiLabelOf: (model) => (model === 'gpt-image-2' ? 'GPT Image 2' : model),
    ...input,
  })
}

describe('当前来源', () => {
  it('存了来源以存的为准（推荐 app: 模型被用户当 API 选过，就一直是 API）', () => {
    expect(state({ model: 'app:a1', channelId: 'rh', source: 'api' }).source).toBe('api')
  })
  it('老节点：workflow: → 工作流；导入过的 app: → 工作流；没导入的 app: → API', () => {
    expect(state({ model: 'workflow:w1', channelId: 'rh' }).source).toBe('workflow')
    expect(state({ model: 'app:a1', channelId: 'rh' }).source).toBe('workflow')
    expect(state({ model: 'app:999', channelId: 'rh' }).source).toBe('api')
  })
  it('老节点：cli:<tool> 或挂在 CLI 协议渠道上 → CLI，并认出是哪个工具', () => {
    const direct = state({ model: 'cli:jimeng', channelId: 'cli:jimeng' })
    expect([direct.source, direct.cliToolId, direct.cliTool?.tool.id]).toEqual(['cli', 'jimeng', 'jimeng'])
    const legacy = state({ model: 'jimeng-image', channelId: 'ch-jimeng' })
    expect([legacy.source, legacy.cliToolId]).toEqual(['cli', 'jimeng'])
    expect(cliToolIdOf({ model: 'x', channelId: 'ch-a' }, CHANNELS)).toBeNull()
  })
})

describe('每个标签的勾 = 这个来源上次选的那一项', () => {
  it('当前来源读顶层，其它来源读存档；API 显示名走逻辑名', () => {
    const s = state({
      source: 'workflow',
      model: 'workflow:w1',
      channelId: 'rh',
      sourceSlots: {
        api: { model: 'gpt-image-2', channelId: 'ch-a', params: { ratio: '16:9' } },
        cli: { model: 'cli:jimeng', channelId: 'cli:jimeng', params: {} },
      },
    })
    expect(s.selected).toEqual({ workflow: 'rh::workflow:w1', api: 'api::GPT Image 2', cli: 'cli::jimeng' })
  })
  it('从没去过的来源不打勾', () => {
    expect(state({ source: 'api', model: 'gpt-image-2', channelId: 'ch-a' }).selected).toEqual({ api: 'api::GPT Image 2' })
  })
})

describe('老节点补写来源（只在判得准时）', () => {
  it('没存来源、渠道与条目都读完 → 写回推断结果', () => {
    expect(state({ model: 'app:a1', channelId: 'rh' }).adopt).toBe('workflow')
    expect(state({ model: 'gpt-image-2', channelId: 'ch-a' }).adopt).toBe('api')
    expect(state({ model: 'jimeng-image', channelId: 'ch-jimeng' }).adopt).toBe('cli')
  })
  it('已存来源 / 没有模型 → 不写', () => {
    expect(state({ model: 'gpt-image-2', channelId: 'ch-a', source: 'api' }).adopt).toBeNull()
    expect(state({ model: '', channelId: '' }).adopt).toBeNull()
  })
  it('渠道店还没读完 → 不写（否则 CLI 渠道的老节点会被写死成 API）', () => {
    expect(state({ model: 'jimeng-image', channelId: 'ch-jimeng' }, { channels: [] }).adopt).toBeNull()
  })
  it('app: 在条目读完之前 → 不写（否则导入过的应用会被写死成 API）', () => {
    const loading = { ...SOURCES, loaded: false }
    expect(state({ model: 'app:a1', channelId: 'rh' }, { workflowSources: loading }).adopt).toBeNull()
    expect(state({ model: 'app:a1', channelId: 'rh' }, { workflowSources: null }).adopt).toBeNull()
    /** 普通 API 模型不用等条目 */
    expect(state({ model: 'gpt-image-2', channelId: 'ch-a' }, { workflowSources: null }).adopt).toBe('api')
  })
})

describe('运行前按来源拦截（给原因）', () => {
  it('API：不在这里拦（渠道缺口由面板原有逻辑说）', () => {
    expect(state({ source: 'api', model: 'gpt-image-2', channelId: 'ch-a' }).blockedReason).toBeNull()
  })
  it('工作流：条目在 → 放行；条目被删 / 不在当前渠道 → 拦', () => {
    expect(state({ source: 'workflow', model: 'workflow:w1', channelId: 'rh' }).blockedReason).toBeNull()
    expect(state({ source: 'workflow', model: 'workflow:404', channelId: 'rh' }).blockedReason).toMatch(/已被删除或不在当前渠道/)
    expect(state({ source: 'workflow', model: 'app:w1', channelId: 'rh' }).blockedReason).toMatch(/已被删除/)
  })
  it('工作流：条目还没读完 → 先不拦（不闪「已被删除」）', () => {
    expect(state({ source: 'workflow', model: 'workflow:404', channelId: 'rh' }, { workflowSources: { ...SOURCES, loaded: false } }).blockedReason).toBeNull()
    expect(state({ source: 'workflow', model: 'workflow:404', channelId: 'rh' }, { workflowSources: null }).blockedReason).toBeNull()
  })
  it('CLI：可用且能出这一类 → 放行', () => {
    expect(state({ source: 'cli', model: 'cli:jimeng', channelId: 'cli:jimeng' }).blockedReason).toBeNull()
  })
  it('CLI：网页版 → 拦，说要桌面版', () => {
    const web = state({ source: 'cli', model: 'cli:jimeng', channelId: 'cli:jimeng' }, { cli: { desktop: false, tools: [] } })
    expect(web.blockedReason).toMatch(/桌面版/)
  })
  it('CLI：命令未检测到 → 拦，点名命令', () => {
    const missing = state({ source: 'cli', model: 'cli:jimeng', channelId: 'cli:jimeng' }, { cli: desktop('missing') })
    expect(missing.blockedReason).toMatch(/未检测到「即梦.*」的命令「jimeng」/)
  })
  it('CLI：工具不能出这一类（生图节点选了 Codex）→ 拦', () => {
    expect(state({ source: 'cli', model: 'cli:codex', channelId: 'cli:codex' }).blockedReason).toMatch(/不能出图/)
  })
  it('CLI：工具表里没有这个工具 → 拦', () => {
    expect(state({ source: 'cli', model: 'cli:ghost', channelId: 'cli:ghost' }).blockedReason).toMatch(/找不到本机 CLI 工具「ghost」/)
  })
  it('CLI：探测结果还没回来 → 先不拦（不拿空数据冤枉它）', () => {
    expect(state({ source: 'cli', model: 'cli:jimeng', channelId: 'cli:jimeng' }, { cli: null }).blockedReason).toBeNull()
  })
})
