import { describe, expect, it } from 'vitest'
import type { GenerationData } from './node'
import {
  cliModelId,
  inferSource,
  nodeSource,
  sourceOfModel,
  sourceSlotOf,
  switchSourcePatch,
  toolIdOfCliModel,
} from './generationSource'
import { generationParams } from '../nodeSpecs/params'
import { newGeneratingNodeData } from '../nodeSpecs/newNodePreset'

type Data = Partial<GenerationData> & { model: string; channelId: string }
const apply = (data: Data, patch: Partial<GenerationData>): Data => ({ ...data, ...patch }) as Data

const API: Data = { mode: 'image', model: 'GPT Image 2', channelId: 'ch-a', ratio: '16:9', resolution: '2k', count: 2, quality: 'high' }
const ENTRY_LIST = [{ nodeId: '3', fieldName: 'prompt', fieldValue: '猫' }]

describe('来源判定（#1133 逻辑 1 / 5）', () => {
  it('cli: 前缀 ↔ 工具 id 往返', () => {
    expect(cliModelId('jimeng')).toBe('cli:jimeng')
    expect(toolIdOfCliModel('cli:jimeng')).toBe('jimeng')
    expect(toolIdOfCliModel('cli:')).toBeNull()
    expect(toolIdOfCliModel('jimeng-image')).toBeNull()
  })

  it('只看前缀：workflow: / cli: 可靠，app: 按 API 算（要条目表才判得出）', () => {
    expect(sourceOfModel('workflow:1')).toBe('workflow')
    expect(sourceOfModel('cli:codex')).toBe('cli')
    expect(sourceOfModel('app:1')).toBe('api')
    expect(sourceOfModel('GPT Image 2')).toBe('api')
  })

  it('老节点：导入过的 app 条目归工作流、推荐 app 归 API、CLI 渠道上的老模型归 CLI', () => {
    const isEntryModel = (model: string) => model === 'app:imported'
    const isCliChannel = (id: string) => id === 'ch-jimeng-cli'
    expect(inferSource({ model: 'app:imported', channelId: 'rh' }, { isEntryModel })).toBe('workflow')
    expect(inferSource({ model: 'app:recommended', channelId: 'rh' }, { isEntryModel })).toBe('api')
    expect(inferSource({ model: 'jimeng-image', channelId: 'ch-jimeng-cli' }, { isCliChannel })).toBe('cli')
    expect(inferSource({ model: 'workflow:9', channelId: 'rh' })).toBe('workflow')
  })

  it('存了来源就以存的为准（推荐 app 被显式选成 API 后不会被前缀改判）', () => {
    expect(nodeSource({ model: 'app:x', channelId: 'rh', source: 'api' }, { isEntryModel: () => true })).toBe('api')
  })
})

describe('切换来源（#1133 逻辑 1 / 2 / 3）', () => {
  it('工作流来源保留 ComfyUI 原始 graph，并在生成参数中一并下发', () => {
    const graph = { '1': { class_type: 'LoadImage', inputs: { image: 'old.png' } } }
    const data = apply(API, switchSourcePatch(API, {
      source: 'workflow', model: 'workflow:comfy', channelId: 'local',
      defaults: { workflowJson: graph, workflowNodeInfoList: ENTRY_LIST, workflowMediaPolicy: 'prune-workflow', workflowOptionalMediaIds: ['1::image'], workflowInstance: 'default' },
    }))
    expect(data.workflowJson).toEqual(graph)
    expect(generationParams(data as GenerationData)).toEqual({ workflow: ENTRY_LIST, workflowJson: graph, workflowMediaPolicy: 'prune-workflow', workflowOptionalMediaIds: ['1::image'] })
    const back = apply(data, switchSourcePatch(data, { source: 'api', model: API.model, channelId: API.channelId }))
    const again = apply(back, switchSourcePatch(back, { source: 'workflow', model: 'workflow:comfy', channelId: 'local' }))
    expect(again.workflowJson).toEqual(graph)
  })

  it('API → 工作流：API 参数收进存档、顶层清掉，提交体只剩工作流的', () => {
    const patch = switchSourcePatch(API, {
      source: 'workflow', model: 'workflow:9', channelId: 'rh',
      defaults: { workflowNodeInfoList: ENTRY_LIST, workflowInstance: 'default' },
    })
    const next = apply(API, patch)
    expect(next.source).toBe('workflow')
    expect(next.ratio).toBeUndefined()
    expect(next.resolution).toBeUndefined()
    expect(next.workflowNodeInfoList).toEqual(ENTRY_LIST)
    expect(next.sourceSlots?.api).toEqual({ model: 'GPT Image 2', channelId: 'ch-a', params: { ratio: '16:9', resolution: '2k', count: 2, quality: 'high' } })
    const params = generationParams(next as GenerationData)
    expect(params).toEqual({ workflow: ENTRY_LIST })
    expect(params).not.toHaveProperty('ratio')
  })

  it('切回 API 再切回工作流：两边参数都不丢，各自记住上次选的项', () => {
    const toFlow = apply(API, switchSourcePatch(API, { source: 'workflow', model: 'workflow:9', channelId: 'rh', defaults: { workflowNodeInfoList: ENTRY_LIST } }))
    const edited = { ...toFlow, workflowNodeInfoList: [{ nodeId: '3', fieldName: 'prompt', fieldValue: '狗' }], workflowInstance: 'plus' as const }
    const backToApi = apply(edited, switchSourcePatch(edited, { source: 'api', model: 'GPT Image 2', channelId: 'ch-a' }))
    expect(backToApi).toMatchObject({ source: 'api', ratio: '16:9', resolution: '2k', count: 2, quality: 'high' })
    expect(backToApi.workflowNodeInfoList).toBeUndefined()
    expect(sourceSlotOf(backToApi, 'workflow')?.model).toBe('workflow:9')
    const again = apply(backToApi, switchSourcePatch(backToApi, { source: 'workflow', model: 'workflow:9', channelId: 'rh', defaults: { workflowNodeInfoList: ENTRY_LIST } }))
    expect(again.workflowNodeInfoList).toEqual([{ nodeId: '3', fieldName: 'prompt', fieldValue: '狗' }])
    expect(again.workflowInstance).toBe('plus')
    expect(again.ratio).toBeUndefined()
  })

  it('跨来源换成**另一个**条目：用新条目默认值，不拿存档里旧条目的值串门', () => {
    const flow: Data = { mode: 'image', source: 'workflow', model: 'workflow:9', channelId: 'rh', workflowNodeInfoList: [{ nodeId: '1', fieldName: 'a', fieldValue: 'old' }] }
    const api = apply(flow, switchSourcePatch(flow, { source: 'api', model: 'GPT Image 2', channelId: 'ch-a' }))
    const other = apply(api, switchSourcePatch(api, { source: 'workflow', model: 'workflow:7', channelId: 'rh', defaults: { workflowNodeInfoList: ENTRY_LIST } }))
    expect(other.workflowNodeInfoList).toEqual(ENTRY_LIST)
  })

  it('同来源换条目也换成新条目默认；换 API 模型参数保留', () => {
    const flow: Data = { mode: 'image', source: 'workflow', model: 'workflow:9', channelId: 'rh', workflowNodeInfoList: [{ nodeId: '1', fieldName: 'a', fieldValue: 'old' }], workflowInstance: 'plus' }
    const other = apply(flow, switchSourcePatch(flow, { source: 'workflow', model: 'app:5', channelId: 'rh', defaults: { workflowNodeInfoList: ENTRY_LIST } }))
    expect(other.workflowNodeInfoList).toEqual(ENTRY_LIST)
    expect(other.workflowInstance).toBeUndefined()
    const api2 = apply(API, switchSourcePatch(API, { source: 'api', model: 'Nano Banana Pro', channelId: 'ch-b' }))
    expect(api2).toMatchObject({ model: 'Nano Banana Pro', channelId: 'ch-b', ratio: '16:9', count: 2 })
  })

  it('API → CLI：不带任何 API 参数进提交体；切回 API 参数还在', () => {
    const cli = apply(API, switchSourcePatch(API, { source: 'cli', model: 'cli:jimeng', channelId: 'cli:jimeng' }))
    expect(cli).toMatchObject({ source: 'cli', model: 'cli:jimeng' })
    expect(generationParams(cli as GenerationData)).toEqual({})
    const back = apply(cli, switchSourcePatch(cli, { source: 'api', model: 'GPT Image 2', channelId: 'ch-a' }))
    expect(back).toMatchObject({ ratio: '16:9', resolution: '2k', count: 2, quality: 'high' })
    expect(sourceSlotOf(back, 'cli')?.model).toBe('cli:jimeng')
  })

  it('老节点（没存来源）的 workflow: 也不再带 API 比例；API 节点照旧', () => {
    const legacy = { mode: 'image', model: 'workflow:9', channelId: 'rh', ratio: '16:9', workflowNodeInfoList: ENTRY_LIST } as GenerationData
    expect(generationParams(legacy)).toEqual({ workflow: ENTRY_LIST })
    expect(generationParams(API as GenerationData)).toMatchObject({ ratio: '16:9', count: 2 })
  })
})

describe('新建节点默认 API（#1133 逻辑 2）', () => {
  it('配方是普通模型 → 带 source: api；配方是 cli: / workflow: → 回 spec 默认', () => {
    expect(newGeneratingNodeData('generation', { channelId: 'ch-a', model: 'GPT Image 2' })).toMatchObject({ source: 'api', model: 'GPT Image 2' })
    expect(newGeneratingNodeData('generation', { channelId: 'cli:jimeng', model: 'cli:jimeng' })).toEqual({})
  })
})
