import { describe, expect, it } from 'vitest'
import { createMemoryPlatform } from '../memory'
import type { NetworkRequest, NetworkResponse } from '../ports'
import { createRunningHubAdapter } from './runninghub'
import { ChannelError, type ImageRunRequest } from './types'
import type { ResolvedChannelConfig } from './registry'
import { generationParams } from '../../domain/canvas/nodeSpecs/params'
import type { GenerationData } from '../../domain/canvas/model/node'
import { UPSTREAM_MEDIA_VALUE } from '../../domain/project/workflowParamValues'
import { workflowRunList } from '../../domain/project/workflowRunList'
import { workflowEntriesRowId, type WorkflowEntry, type WorkflowParamField } from '../../domain/project/workflowParams'

/**
 * 「节点数据 → generationParams → 适配器请求体」端到端（#1127 H1 / M3 / M9 / M10 / H3）。
 *
 * 审查报告指出的缝：下层纯函数各有单测，但没有一条从节点数据一路走到请求体——
 * H1（应用参数发不出去）就藏在这条缝里。这里每条都从 `GenerationData` 起步。
 */

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 2, 0, 0, 0, 1, 8, 2, 0, 0, 0])

function res(status: number, body: unknown, mime = 'application/json'): NetworkResponse {
  return {
    status,
    headers: { 'content-type': mime },
    async text() {
      return typeof body === 'string' ? body : JSON.stringify(body)
    },
    async json<T>() {
      return body as T
    },
    async arrayBuffer() {
      return PNG.slice().buffer
    },
  }
}

const config: ResolvedChannelConfig = {
  id: 'ch_rh',
  protocol: 'runninghub-api',
  baseUrl: 'https://www.runninghub.cn',
  credentialRef: null,
  modelCache: [],
  apiKey: 'rh-key',
}
const signal = new AbortController().signal
const FAST = { sleep: async () => {}, pollIntervalMs: 0 }

function field(partial: Partial<WorkflowParamField> & Pick<WorkflowParamField, 'nodeId' | 'fieldName' | 'type'>): WorkflowParamField {
  return {
    id: `${partial.nodeId}::${partial.fieldName}`,
    label: partial.fieldName,
    value: '',
    enabled: true,
    group: '',
    options: [],
    min: null,
    max: null,
    step: null,
    seed: false,
    required: false,
    mediaOrder: 0,
    ...partial,
  }
}

const workflowEntry: WorkflowEntry = {
  id: 'wf1',
  kind: 'workflow',
  title: '换背景',
  provider: 'runninghub',
  fetchedAt: 1,
  fields: [
    field({ nodeId: '6', fieldName: 'text', type: 'textarea', value: 'default prompt' }),
    field({ nodeId: '3', fieldName: 'seed', type: 'number', value: '669816362794144', seed: true }),
    field({ nodeId: '10', fieldName: 'video', type: 'video', required: true }),
    field({ nodeId: '11', fieldName: 'image', type: 'image', required: true }),
    field({ nodeId: '5', fieldName: 'width', type: 'number', value: '512', enabled: false }),
  ],
}

const appEntry: WorkflowEntry = {
  id: '2061690429824917505',
  kind: 'app',
  title: '全能图片PRO-图生图',
  provider: 'runninghub',
  fetchedAt: 1,
  fields: [
    field({ nodeId: '3', fieldName: 'image', type: 'image', required: true }),
    field({ nodeId: '1', fieldName: 'resolution', type: 'text', value: '2k' }),
    field({ nodeId: '1', fieldName: 'prompt', type: 'textarea', value: '默认提示词' }),
  ],
}

const APP_NODES = [
  { nodeId: '3', fieldName: 'image', fieldType: 'IMAGE', fieldValue: 'default.jpg' },
  { nodeId: '1', fieldName: 'resolution', fieldType: 'STRING', fieldValue: '2k' },
  { nodeId: '1', fieldName: 'prompt', fieldType: 'STRING', fieldValue: '默认提示词' },
]

function harness(entries: WorkflowEntry[] | null, assets: { id: string; bytes: Uint8Array; mime: string }[] = []) {
  const submits: { url: string; body: unknown }[] = []
  const uploads: string[] = []
  const platform = createMemoryPlatform({
    rows: {
      ...(entries ? { presets: [{ id: workflowEntriesRowId('ch_rh'), entries } as never] } : {}),
      assets: assets as never,
    },
    handler: async (req: NetworkRequest) => {
      if (req.url.includes('/api/webapp/apiCallDemo')) return res(200, { code: 0, data: { nodeInfoList: APP_NODES } })
      if (req.url.includes('/openapi/v2/run/')) {
        submits.push({ url: req.url, body: req.body })
        return res(200, { taskId: 't1', status: 'QUEUED', errorCode: '' })
      }
      if (req.url.endsWith('/openapi/v2/media/upload/binary')) {
        const file = (req.body as FormData).get('file') as File
        uploads.push(`${file.type}:${file.name}`)
        return res(200, { code: 0, data: { fileName: `openapi/${file.type.split('/')[0]}-${uploads.length}` } })
      }
      if (req.url.endsWith('/openapi/v2/query')) return res(200, { status: 'SUCCESS', results: [{ url: 'https://files.runninghub.cn/o.png' }] })
      return res(200, '', 'image/png')
    },
  })
  return { adapter: createRunningHubAdapter(config, platform, FAST), submits, uploads }
}

function nodeData(model: string, list: { nodeId: string; fieldName: string; fieldValue: string }[], extra: Partial<GenerationData> = {}): GenerationData {
  return {
    mode: 'image',
    prompt: '',
    linkedPromptNodeIds: [],
    channelId: 'ch_rh',
    model,
    thumbOrder: [],
    upstreamHidden: [],
    workflowNodeInfoList: list,
    ...extra,
  } as GenerationData
}

function request(data: GenerationData, inputs: ImageRunRequest['inputs'] = [], prompt = ''): ImageRunRequest {
  return { kind: 'image', channelId: 'ch_rh', model: data.model, prompt, inputs, params: generationParams(data) }
}

describe('节点数据 → 请求体（#1127）', () => {
  it('★ H1：app: 模型的面板参数进 params.workflow，并按 nodeId+fieldName 覆盖到应用节点；48G 也带上', async () => {
    const data = nodeData(`app:${appEntry.id}`, [{ nodeId: '1', fieldName: 'resolution', fieldValue: '4k' }], { workflowInstance: 'plus' })
    expect(generationParams(data).workflow).toEqual([{ nodeId: '1', fieldName: 'resolution', fieldValue: '4k' }])
    expect(generationParams(data).instanceType).toBe('plus')
    const { adapter, submits } = harness([appEntry])
    await adapter.generateImage(request(data), signal)
    const body = submits[0]!.body as { nodeInfoList: { nodeId: string; fieldName: string; fieldValue: string }[]; instanceType?: string }
    expect(submits[0]!.url).toContain(`/openapi/v2/run/ai-app/${appEntry.id}`)
    expect(body.nodeInfoList.find((n) => n.fieldName === 'resolution')?.fieldValue).toBe('4k')
    expect(body.instanceType).toBe('plus')
  })

  it('★ M10：主提示词为空时不把应用 prompt 节点清成空串；没有上游图时保留应用默认图', async () => {
    const data = nodeData(`app:${appEntry.id}`, [])
    const { adapter, submits } = harness([appEntry])
    await adapter.generateImage(request(data), signal)
    const body = submits[0]!.body as { nodeInfoList: { fieldName: string; fieldValue: string }[] }
    expect(body.nodeInfoList.find((n) => n.fieldName === 'prompt')?.fieldValue).toBe('默认提示词')
    expect(body.nodeInfoList.find((n) => n.fieldName === 'image')?.fieldValue).toBe('default.jpg')
    expect(JSON.stringify(body)).not.toContain(UPSTREAM_MEDIA_VALUE)
  })

  it('★ M3：上游一图一视频 → 视频槽拿视频、图片槽拿图片（不按全局下标乱分）', async () => {
    const data = nodeData('workflow:wf1', [
      { nodeId: '10', fieldName: 'video', fieldValue: UPSTREAM_MEDIA_VALUE },
      { nodeId: '11', fieldName: 'image', fieldValue: UPSTREAM_MEDIA_VALUE },
    ])
    const { adapter, submits, uploads } = harness(
      [workflowEntry],
      [
        { id: 'img', bytes: PNG, mime: 'image/png' },
        { id: 'vid', bytes: new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70]), mime: 'video/mp4' },
      ],
    )
    await adapter.generateImage(
      request(data, [
        { kind: 'asset', nodeId: 'a', assetHash: 'img', mime: 'image/png' },
        { kind: 'asset', nodeId: 'b', assetHash: 'vid', mime: 'video/mp4' },
      ]),
      signal,
    )
    const list = (submits[0]!.body as { nodeInfoList: { nodeId: string; fieldValue: string }[] }).nodeInfoList
    expect(list.find((n) => n.nodeId === '10')?.fieldValue).toMatch(/^openapi\/video-/)
    expect(list.find((n) => n.nodeId === '11')?.fieldValue).toMatch(/^openapi\/image-/)
    expect(uploads.some((u) => u.startsWith('video/mp4:'))).toBe(true)
  })

  it('★ M9：执行期以最新条目为准——设置页取消暴露的不发、新暴露的带默认值发；种子不按 uint32 取模', async () => {
    const data = nodeData('workflow:wf1', [
      { nodeId: '6', fieldName: 'text', fieldValue: 'a cat' },
      { nodeId: '5', fieldName: 'width', fieldValue: '2048' },
    ])
    const { adapter, submits } = harness([workflowEntry])
    await adapter.generateImage(request(data), signal)
    const list = (submits[0]!.body as { nodeInfoList: { nodeId: string; fieldName: string; fieldValue: string }[] }).nodeInfoList
    expect(list.find((n) => n.nodeId === '5')).toBeUndefined()
    expect(list.find((n) => n.nodeId === '6')?.fieldValue).toBe('a cat')
    expect(list.find((n) => n.fieldName === 'seed')?.fieldValue).toBe('669816362794144')
  })

  it('★ 主提示词框非空 → 填进第一个暴露的提示词字段（工作流不再「写了也白写」）', () => {
    const { list } = workflowRunList(workflowEntry, [{ nodeId: '6', fieldName: 'text', fieldValue: 'old' }], '一只橘猫')
    expect(list.find((n) => n.nodeId === '6')?.fieldValue).toBe('一只橘猫')
  })

  it('★ H3：节点模型指向已删除的条目 → 拦下不提交（不拿别的条目的 nodeId 去跑）', async () => {
    const data = nodeData('workflow:gone', [{ nodeId: '6', fieldName: 'text', fieldValue: 'x' }])
    const { adapter, submits } = harness([workflowEntry])
    const err = await adapter.generateImage(request(data), signal).catch((e: unknown) => e as ChannelError)
    expect((err as ChannelError).appError).toMatchObject({ kind: 'validation' })
    expect(submits).toHaveLength(0)
  })

  it('必填的非媒体字段被清空 → 提交前拦下，并说出是哪个参数', async () => {
    const entry = { ...workflowEntry, fields: [field({ nodeId: '6', fieldName: 'text', type: 'text', required: true, label: '正向提示词' })] }
    const data = nodeData('workflow:wf1', [{ nodeId: '6', fieldName: 'text', fieldValue: '  ' }])
    const { adapter, submits } = harness([entry])
    const err = await adapter.generateImage(request(data), signal).catch((e: unknown) => e as ChannelError)
    expect(JSON.stringify((err as ChannelError).appError)).toContain('正向提示词')
    expect(submits).toHaveLength(0)
  })

  it('这条渠道从没存过条目行（老数据）→ 按节点存的提交体原样发', async () => {
    const data = nodeData('workflow:wf1', [{ nodeId: '6', fieldName: 'text', fieldValue: 'x' }])
    const { adapter, submits } = harness(null)
    await adapter.generateImage(request(data), signal)
    expect((submits[0]!.body as { nodeInfoList: unknown[] }).nodeInfoList).toEqual([{ nodeId: '6', fieldName: 'text', fieldValue: 'x' }])
  })
})
