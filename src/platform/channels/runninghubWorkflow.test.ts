import { describe, expect, it } from 'vitest'
import type { NetworkRequest, NetworkResponse } from '../ports'
import {
  fetchAppFields,
  fetchWorkflowFields,
  queryWorkflowTask,
  submitAppTask,
  submitWorkflowTask,
  uploadWorkflowAsset,
  webappIdPayload,
  type WorkflowEndpoint,
} from './runninghubWorkflow'
import { ChannelError } from './types'

/**
 * 一个只记请求、按回调回包的假网络。刻意不引 `createMemoryPlatform`：
 * 这个模块只用到 `network.request` 一件事，把整份平台假起来反而会掩盖"它到底依赖了什么"。
 */
function fakeNet(handler: (req: NetworkRequest) => { status?: number; body: unknown }) {
  const calls: NetworkRequest[] = []
  const network = {
    async request(req: NetworkRequest): Promise<NetworkResponse> {
      calls.push(req)
      const { status = 200, body } = handler(req)
      const text = typeof body === 'string' ? body : JSON.stringify(body)
      return {
        status,
        headers: { 'content-type': 'application/json' },
        async text() {
          return text
        },
        async json<T>() {
          return body as T
        },
        async arrayBuffer() {
          return new ArrayBuffer(0)
        },
      }
    },
  }
  return { deps: { network } as never, calls }
}

/** 取 ChannelError 的 `appError.body`（它才是给人看的那句话；`message` 只有 `[channel] xxx`） */
async function errorBodyOf(run: Promise<unknown>): Promise<string> {
  try {
    await run
  } catch (error) {
    const appError = (error as ChannelError).appError as { body?: string; raw?: string; detail?: string }
    return String(appError?.body ?? appError?.raw ?? appError?.detail ?? '')
  }
  throw new Error('预期抛错，但没有抛')
}

const endpoint: WorkflowEndpoint = { host: 'https://www.runninghub.cn', apiKey: 'k' }
const signal = new AbortController().signal

/** 官方示例里的工作流 JSON（`getJsonApiFormat` 的 `data.prompt`） */
const workflowJson = {
  '3': {
    class_type: 'KSampler',
    _meta: { title: 'KSampler' },
    inputs: { seed: 669816362794144, steps: 20, negative: ['7', 0], positive: ['6', 0] },
  },
  '6': {
    class_type: 'CLIPTextEncode',
    _meta: { title: 'CLIP Text Encode (Prompt)' },
    inputs: { text: 'a cute panda' },
  },
}

describe('fetchWorkflowFields', () => {
  it('★ data.prompt 是字符串：要自己 JSON.parse，且连线值不进字段表', async () => {
    const { deps, calls } = fakeNet(() => ({
      body: { code: 0, msg: 'SUCCESS', data: { prompt: JSON.stringify(workflowJson) } },
    }))
    const fields = await fetchWorkflowFields(deps, endpoint, '1904136902449209346', signal)
    expect(calls[0]?.url).toBe('https://www.runninghub.cn/api/openapi/getJsonApiFormat')
    expect(calls[0]?.method).toBe('POST')
    expect(calls[0]?.body).toEqual({ apiKey: 'k', workflowId: '1904136902449209346' })
    expect(fields.map((field) => field.id)).toEqual([
      '3::seed',
      '3::steps',
      '6::text',
    ])
    /** 工作流那条路默认全隐藏（与应用的"默认全暴露"相反） */
    expect(fields.every((field) => field.enabled === false)).toBe(true)
    expect(fields.find((field) => field.id === '3::seed')?.seed).toBe(true)
  })

  it('没有可改参数时报一句能行动的话（不是"失败了"）', async () => {
    const { deps } = fakeNet(() => ({ body: { code: 0, data: { prompt: '{}' } } }))
    expect(await errorBodyOf(fetchWorkflowFields(deps, endpoint, 'w', signal))).toContain('没有可改参数')
  })

  it('上游报错时把它的原话与 code 带出来', async () => {
    const { deps } = fakeNet(() => ({ body: { code: 301, msg: 'PARAMS_INVALID' } }))
    expect(await errorBodyOf(fetchWorkflowFields(deps, endpoint, 'w', signal))).toContain('PARAMS_INVALID')
  })
})

describe('fetchAppFields', () => {
  it('GET apiCallDemo（apiKey / webappId 进 query）并解析成字段表', async () => {
    const { deps, calls } = fakeNet(() => ({
      body: {
        code: 0,
        data: {
          nodeInfoList: [
            {
              nodeId: '122',
              nodeName: 'SeargePromptText',
              fieldName: 'prompt',
              fieldValue: 'hi',
              fieldType: 'STRING',
              fieldData: '["STRING", {"multiline": true}]',
              description: 'prompt提示词',
            },
          ],
        },
      },
    }))
    const fields = await fetchAppFields(deps, endpoint, '1877265245566922753', signal)
    expect(calls[0]?.method).toBe('GET')
    expect(calls[0]?.url).toContain('/api/webapp/apiCallDemo?apiKey=k&webappId=1877265245566922753')
    expect(fields[0]).toMatchObject({ type: 'textarea', label: 'prompt提示词', enabled: true })
  })

  it('没有可改节点时抛 unsupported（调用方据此提示"先在网页端跑一次"）', async () => {
    const { deps } = fakeNet(() => ({ body: { code: 0, data: { nodeInfoList: [] } } }))
    await expect(fetchAppFields(deps, endpoint, '1', signal)).rejects.toBeInstanceOf(ChannelError)
  })
})

describe('提交', () => {
  it('简易式：不传 nodeInfoList（= 不改任何参数直接跑）', async () => {
    const { deps, calls } = fakeNet(() => ({ body: { code: 0, data: { taskId: '1904737800233889793' } } }))
    const taskId = await submitWorkflowTask(deps, endpoint, { workflowId: 'w1' }, signal)
    expect(taskId).toBe('1904737800233889793')
    expect(calls[0]?.url).toBe('https://www.runninghub.cn/task/openapi/create')
    expect(calls[0]?.body).toEqual({ apiKey: 'k', workflowId: 'w1' })
  })

  it('高级式：带 nodeInfoList；instanceType 只有非 default 才发', async () => {
    const { deps, calls } = fakeNet(() => ({ body: { code: 0, data: { taskId: 't' } } }))
    await submitWorkflowTask(
      deps,
      endpoint,
      {
        workflowId: 'w1',
        nodeInfoList: [{ nodeId: '6', fieldName: 'text', fieldValue: 'a girl' }],
        instanceType: 'plus',
      },
      signal,
    )
    expect(calls[0]?.body).toEqual({
      apiKey: 'k',
      workflowId: 'w1',
      nodeInfoList: [{ nodeId: '6', fieldName: 'text', fieldValue: 'a girl' }],
      instanceType: 'plus',
    })
    const second = fakeNet(() => ({ body: { code: 0, data: { taskId: 't' } } }))
    await submitWorkflowTask(second.deps, endpoint, { workflowId: 'w1', instanceType: 'default' }, signal)
    expect(second.calls[0]?.body).toEqual({ apiKey: 'k', workflowId: 'w1' })
  })

  it('★ 应用提交：19 位 webappId 不能转 Number（转了就丢精度，会跑到别的应用上）', async () => {
    const { deps, calls } = fakeNet(() => ({ body: { code: 0, data: { taskId: 't' } } }))
    await submitAppTask(
      deps,
      endpoint,
      { webappId: '1877265245566922753', nodeInfoList: [{ nodeId: '122', fieldName: 'prompt', fieldValue: 'x' }] },
      signal,
    )
    expect(calls[0]?.url).toBe('https://www.runninghub.cn/task/openapi/ai-app/run')
    /** 发字符串，位数一个不少；若 `Number()` 过就会变成 …800 */
    expect((calls[0]?.body as Record<string, unknown>).webappId).toBe('1877265245566922753')
    expect(webappIdPayload('1877265245566922753')).toBe('1877265245566922753')
    /** 安全整数仍发数字（与官方示例一致） */
    expect(webappIdPayload('123456789')).toBe(123456789)
  })

  it('没有 taskId 时把 promptTips 原话带出来（那里通常写着哪个节点挂了）', async () => {
    const { deps } = fakeNet(() => ({
      body: { code: 0, data: { promptTips: '{"result": false, "node_errors": {"6": "bad"}}' } },
    }))
    expect(await errorBodyOf(submitWorkflowTask(deps, endpoint, { workflowId: 'w' }, signal))).toContain(
      'node_errors',
    )
  })
})

describe('queryWorkflowTask', () => {
  it('成功：结果三种地址形状都认', async () => {
    const { deps, calls } = fakeNet(() => ({
      body: {
        taskId: 't1',
        status: 'SUCCESS',
        results: [{ url: 'https://a/1.png' }, { fileUrl: 'https://a/2.mp4' }],
        usage: { taskCostTime: '12' },
      },
    }))
    const result = await queryWorkflowTask(deps, endpoint, 't1', signal)
    expect(calls[0]?.url).toBe('https://www.runninghub.cn/openapi/v2/query')
    expect(result).toMatchObject({
      status: 'SUCCESS',
      urls: ['https://a/1.png', 'https://a/2.mp4'],
      costSeconds: '12',
    })
  })

  it('★ 错误在顶层 errorCode / errorMessage（真机 1004），没有 code/msg', async () => {
    const { deps } = fakeNet(() => ({
      body: {
        taskId: '1',
        status: '',
        errorCode: '1004',
        errorMessage: 'Task not found, please check the task ID',
        results: null,
      },
    }))
    const result = await queryWorkflowTask(deps, endpoint, '1', signal)
    expect(result.status).toBe('UNKNOWN')
    expect(result.errorCode).toBe('1004')
    expect(result.errorMessage).toContain('Task not found')
  })

  it('FAILED 照原样报出来，不自己编原因', async () => {
    const { deps } = fakeNet(() => ({
      body: { taskId: 't', status: 'FAILED', errorCode: '805', errorMessage: 'SaveImage failed' },
    }))
    const result = await queryWorkflowTask(deps, endpoint, 't', signal)
    expect(result).toMatchObject({ status: 'FAILED', errorCode: '805' })
  })
})

describe('uploadWorkflowAsset', () => {
  it('走 /task/openapi/upload，回 fileName（媒体字段只认这个）', async () => {
    const { deps, calls } = fakeNet(() => ({
      body: { code: 0, data: { fileName: 'api/abc.png', fileType: 'input' } },
    }))
    const bytes = new Uint8Array([1, 2, 3])
    const fileName = await uploadWorkflowAsset(deps, endpoint, { bytes, mime: 'image/png' }, 'ref.png', signal)
    expect(fileName).toBe('api/abc.png')
    expect(calls[0]?.url).toBe('https://www.runninghub.cn/task/openapi/upload')
    expect(calls[0]?.method).toBe('POST')
    expect(calls[0]?.body).toBeInstanceOf(FormData)
  })

  it('上游不给 fileName 就报错，不返回空串继续跑', async () => {
    const { deps } = fakeNet(() => ({ body: { code: 0, data: {} } }))
    await expect(
      uploadWorkflowAsset(deps, endpoint, { bytes: new Uint8Array([1]), mime: 'image/png' }, 'a.png', signal),
    ).rejects.toBeInstanceOf(ChannelError)
  })
})
