import { parseAppMeta, parseAppNodeInfoList, type WorkflowAppMeta } from '../../domain/project/workflowAppParams'
import { parseWorkflowJsonToFields, type WorkflowParamField } from '../../domain/project/workflowParams'
import { prepareModelImageInput } from './chatImageInput'
import type { NetworkResponse, PlatformKit } from '../ports'
import { ChannelError } from './types'

/**
 * RunningHub **工作流 / AI 应用**的 HTTP 对接（对账 #1104 / #1107）。
 *
 * 为什么单独一个模块、而不是塞进 `runninghub.ts` 那个适配器：
 * 这两条路的请求形状与"标准模型"完全不同（一个是 `{endpoint, prompt}`，一个是
 * `{workflowId|webappId, nodeInfoList}`），共用一个工厂只会让两条链路互相污染；
 * 而它们与适配器真正共享的东西只有"怎么发请求 / 怎么认错误"这两件小事。
 *
 * 接口依据（2026-11-14 官方文档 + 真机只读实测，页 id 见调研文档 §五点五）：
 *
 * | 用途 | 请求 | 出处 |
 * | --- | --- | --- |
 * | 拉工作流全量参数 | `POST /api/openapi/getJsonApiFormat` `{apiKey, workflowId}` → `data.prompt`（JSON 字符串） | `api-425749014` |
 * | 拉应用可改字段 | `GET /api/webapp/apiCallDemo?apiKey=&webappId=` → `data.nodeInfoList` | `api-425749011` |
 * | 提交工作流 | `POST /task/openapi/create`（`nodeInfoList` 可省 = 不改参数直接跑） | `api-425749012/13` |
 * | 提交应用 | `POST /task/openapi/ai-app/run` `{apiKey, webappId, nodeInfoList}` | `api-425749010` |
 * | 上传素材 | `POST /task/openapi/upload`（multipart，`apiKey` + `fileType=input`）→ `data.fileName` | `api-425749007` |
 * | 查任务 | `POST /openapi/v2/query` `{taskId}`（**错误在顶层 `errorCode/errorMessage`**） | `api-425767306` |
 *
 * ⚠️ 提交级的实测还没做（要花钱），所以这里**不写"已验证"**：字段按官方文档与官方插件源码建，
 * 真跑通后再回来把注释改成实测结论。
 */

const GET_JSON_PATH = '/api/openapi/getJsonApiFormat'
const APP_NODE_PATH = '/api/webapp/apiCallDemo'
const CREATE_PATH = '/task/openapi/create'
const APP_RUN_PATH = '/task/openapi/ai-app/run'
const UPLOAD_PATH = '/task/openapi/upload'
const QUERY_PATH = '/openapi/v2/query'

const FETCH_TIMEOUT_MS = 30_000
const SUBMIT_TIMEOUT_MS = 60_000
const UPLOAD_TIMEOUT_MS = 120_000
const QUERY_TIMEOUT_MS = 30_000

export const WORKFLOW_POLL_INTERVAL_MS = 5_000
export const WORKFLOW_POLL_MAX_MS = 20 * 60_000

export interface WorkflowEndpoint {
  /** 基址，如 `https://www.runninghub.cn`（渠道里可改） */
  host: string
  apiKey: string
}

/** 查任务的结果。`status` 用 RunningHub 自己的三个终态词，不自己造。 */
export interface WorkflowTaskResult {
  taskId: string
  status: 'SUCCESS' | 'FAILED' | 'RUNNING' | 'QUEUED' | 'UNKNOWN'
  urls: string[]
  errorCode: string
  errorMessage: string
  /** 秒；上游给的字符串原样保留 */
  costSeconds?: string
}

interface RhEnvelope {
  code?: number | string
  msg?: string
  message?: string
  errorCode?: string
  errorMessage?: string
  status?: string
  taskId?: string
  data?: unknown
  results?: { url?: string; outputUrl?: string; fileUrl?: string }[] | null
  usage?: { taskCostTime?: string | number } | null
}

function hostOf(endpoint: WorkflowEndpoint): string {
  return endpoint.host.replace(/\/+$/, '')
}

async function readJson(res: NetworkResponse): Promise<RhEnvelope> {
  const text = await res.text()
  if (!text) return {}
  try {
    const parsed = JSON.parse(text) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as RhEnvelope) : {}
  } catch {
    throw new ChannelError({
      kind: 'parse',
      raw: `RunningHub 返回了非 JSON（HTTP ${res.status}）：${text.slice(0, 200)}`,
    })
  }
}

/**
 * 错误归一。
 *
 * 两套错误形状都要认，这条是踩过的坑：`/task/openapi/*` 系列回 `{code, msg}`，
 * 而 `/openapi/v2/query` 回的是**顶层 `{errorCode, errorMessage}`**（真机实测 `1004`），
 * 只读 `code/msg` 会把"任务不存在"显示成一句空话。
 */
function failureOf(envelope: RhEnvelope, fallback: string): string {
  const message = envelope.errorMessage || envelope.msg || envelope.message || fallback
  const code = String(envelope.errorCode ?? envelope.code ?? '')
  return code ? `${message}（${code}）` : message
}

function httpError(status: number, body: string): ChannelError {
  return new ChannelError({
    kind: 'http',
    status: status >= 400 ? status : 502,
    body: body.slice(0, 300),
  })
}

async function postJson(
  deps: Pick<PlatformKit, 'network'>,
  endpoint: WorkflowEndpoint,
  path: string,
  body: unknown,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<RhEnvelope> {
  const res = await deps.network.request(
    {
      url: `${hostOf(endpoint)}${path}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(endpoint.apiKey ? { Authorization: `Bearer ${endpoint.apiKey}` } : {}),
      },
      body,
      timeoutMs,
    },
    signal,
  )
  const envelope = await readJson(res)
  if (res.status >= 400) throw httpError(res.status, await res.text())
  return envelope
}

/**
 * 工作流 → 可暴露 / 隐藏的字段表（**默认全部隐藏**）。
 *
 * `data.prompt` 是**字符串**（官方示例如此），不是对象 —— 直接按对象用会拿到一堆 `undefined`。
 */
export async function fetchWorkflowFields(
  deps: Pick<PlatformKit, 'network'>,
  endpoint: WorkflowEndpoint,
  workflowId: string,
  signal: AbortSignal,
): Promise<WorkflowParamField[]> {
  const envelope = await postJson(
    deps,
    endpoint,
    GET_JSON_PATH,
    { apiKey: endpoint.apiKey, workflowId },
    signal,
    FETCH_TIMEOUT_MS,
  )
  if (envelope.code !== 0) {
    throw new ChannelError({ kind: 'http', status: 400, body: failureOf(envelope, '拉取工作流失败') })
  }
  const data = (envelope.data ?? {}) as { prompt?: unknown }
  const prompt = data.prompt
  let workflowJson: unknown = prompt
  if (typeof prompt === 'string') {
    try {
      workflowJson = JSON.parse(prompt) as unknown
    } catch {
      throw new ChannelError({
        kind: 'parse',
        raw: `工作流 JSON 解析失败：${prompt.slice(0, 160)}`,
      })
    }
  }
  const fields = parseWorkflowJsonToFields(workflowJson)
  if (fields.length === 0) {
    throw new ChannelError({
      kind: 'parse',
      raw: '这个工作流没有可改参数（可能还没在网页端成功跑过一次，或全部输入都是连线）',
    })
  }
  return fields
}

/** 一次抓齐：应用元信息（名称 / 封面）+ 可改字段。设置页「填 id 就保存」就调这一个。 */
export async function fetchAppBundle(
  deps: Pick<PlatformKit, 'network'>,
  endpoint: WorkflowEndpoint,
  webappId: string,
  signal: AbortSignal,
): Promise<{ meta: WorkflowAppMeta; fields: WorkflowParamField[] }> {
  const res = await deps.network.request(
    {
      url: `${hostOf(endpoint)}${APP_NODE_PATH}?apiKey=${encodeURIComponent(endpoint.apiKey)}&webappId=${encodeURIComponent(webappId)}`,
      method: 'GET',
      timeoutMs: FETCH_TIMEOUT_MS,
    },
    signal,
  )
  const envelope = await readJson(res)
  if (res.status >= 400) throw httpError(res.status, await res.text())
  if (envelope.code !== 0) {
    throw new ChannelError({ kind: 'http', status: 400, body: failureOf(envelope, '拉取应用失败') })
  }
  const data = (envelope.data ?? {}) as { nodeInfoList?: unknown }
  const meta = parseAppMeta(data)
  const fields = parseAppNodeInfoList(data.nodeInfoList)
  if (fields.length === 0) {
    /** 官方口径：没有可改节点 = 这个应用还没在网页端成功跑过一次 */
    throw new ChannelError({ kind: 'channel', detail: 'unsupported' })
  }
  return { meta, fields }
}


/**
 * AI 应用 → 只要字段表（设置页 / 节点都用不到封面时走这条）。
 *
 * **刻意委托给 `fetchAppBundle`**：两条路各写一份"怎么拉、怎么判空"的实现，
 * 迟早会漂移成"设置页能拉到、节点上拉不到"这种最难查的故障。
 */
export async function fetchAppFields(
  deps: Pick<PlatformKit, 'network'>,
  endpoint: WorkflowEndpoint,
  webappId: string,
  signal: AbortSignal,
): Promise<WorkflowParamField[]> {
  const bundle = await fetchAppBundle(deps, endpoint, webappId, signal)
  return bundle.fields
}

/**
 * 上传素材 → `fileName`（工作流 / 应用的媒体字段吃这个，不吃 URL、不吃 base64）。
 *
 * 顺手把图压到 2048px / ≤2MB（`prepareModelImageInput`）—— 与仓库里其它"素材进上游"的
 * 入口同一条规则，否则几张大图会先撞上游的请求体上限（#691 的教训）。
 */
export async function uploadWorkflowAsset(
  deps: Pick<PlatformKit, 'network'>,
  endpoint: WorkflowEndpoint,
  asset: { bytes: Uint8Array; mime: string },
  fileName: string,
  signal: AbortSignal,
): Promise<string> {
  const prepared = await prepareModelImageInput({ bytes: asset.bytes, mime: asset.mime })
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(prepared.bytes) as BlobPart], { type: prepared.mime }), fileName)
  form.append('apiKey', endpoint.apiKey)
  form.append('fileType', 'input')
  const res = await deps.network.request(
    {
      url: `${hostOf(endpoint)}${UPLOAD_PATH}`,
      method: 'POST',
      headers: endpoint.apiKey ? { Authorization: `Bearer ${endpoint.apiKey}` } : {},
      body: form,
      timeoutMs: UPLOAD_TIMEOUT_MS,
    },
    signal,
  )
  const envelope = await readJson(res)
  if (res.status >= 400) throw httpError(res.status, await res.text())
  const data = (envelope.data ?? {}) as { fileName?: string }
  if (envelope.code !== 0 || !data.fileName) {
    throw new ChannelError({
      kind: 'http',
      status: 400,
      body: failureOf(envelope, '素材上传失败'),
    })
  }
  return data.fileName
}

/** 提交工作流任务。`nodeInfoList` 为空 = 官方"简易式"（不改任何参数直接跑）。 */
export async function submitWorkflowTask(
  deps: Pick<PlatformKit, 'network'>,
  endpoint: WorkflowEndpoint,
  input: {
    workflowId: string
    nodeInfoList?: { nodeId: string; fieldName: string; fieldValue: string }[]
    /** `default` 24G / `plus` 48G / `ultra` 84G（官方文档三档） */
    instanceType?: 'default' | 'plus' | 'ultra'
  },
  signal: AbortSignal,
): Promise<string> {
  const body: Record<string, unknown> = {
    apiKey: endpoint.apiKey,
    workflowId: input.workflowId,
  }
  if (input.nodeInfoList && input.nodeInfoList.length > 0) body.nodeInfoList = input.nodeInfoList
  if (input.instanceType && input.instanceType !== 'default') body.instanceType = input.instanceType
  return submit(deps, endpoint, CREATE_PATH, body, signal, input.workflowId)
}

/**
 * `webappId` 该按什么类型发。
 *
 * ⚠️ 这是个**真坑**（2026-11-14 发现）：应用 id 是 19 位（如 `1877265245566922753`），
 * 超过 `Number.MAX_SAFE_INTEGER`（≈9.007e15）。`Number(id)` 之后 `JSON.stringify` 会变成
 * `1877265245566922800` —— **末几位被改掉**，要么报"应用不存在"，要么跑到别的应用上。
 * 官方示例里写的是数字字面量（那是文档作者的 JSON 文本，不是 JS 运行时），
 * 所以这里：**安全整数才发数字，否则发字符串**（服务端是 Java，数字串会被正常解析成 Long）。
 */
export function webappIdPayload(id: string): number | string {
  const text = String(id ?? '').trim()
  if (!/^\d+$/.test(text)) return text
  const asNumber = Number(text)
  return Number.isSafeInteger(asNumber) ? asNumber : text
}

/** 提交 AI 应用任务 */
export async function submitAppTask(
  deps: Pick<PlatformKit, 'network'>,
  endpoint: WorkflowEndpoint,
  input: {
    webappId: string
    nodeInfoList: { nodeId: string; fieldName: string; fieldValue: string }[]
  },
  signal: AbortSignal,
): Promise<string> {
  return submit(
    deps,
    endpoint,
    APP_RUN_PATH,
    {
      apiKey: endpoint.apiKey,
      webappId: webappIdPayload(input.webappId),
      nodeInfoList: input.nodeInfoList,
    },
    signal,
    input.webappId,
  )
}

async function submit(
  deps: Pick<PlatformKit, 'network'>,
  endpoint: WorkflowEndpoint,
  path: string,
  body: Record<string, unknown>,
  signal: AbortSignal,
  entryId: string,
): Promise<string> {
  const envelope = await postJson(deps, endpoint, path, body, signal, SUBMIT_TIMEOUT_MS)
  if (envelope.code !== 0) {
    throw new ChannelError({
      kind: 'http',
      status: 400,
      body: failureOf(envelope, `提交任务失败（${entryId}）`),
    })
  }
  const data = (envelope.data ?? {}) as { taskId?: string | number; promptTips?: unknown }
  const taskId = data.taskId === undefined || data.taskId === null ? '' : String(data.taskId)
  if (!taskId) {
    /**
     * 没有 taskId 但也没有错误码：`promptTips` 里通常写着哪个节点校验挂了
     * （官方示例里 `node_errors` 非空就是这个）。把原话带出去，别只说"失败了"。
     */
    const tips = typeof data.promptTips === 'string' ? data.promptTips : JSON.stringify(data.promptTips ?? '')
    throw new ChannelError({
      kind: 'http',
      status: 502,
      body: `RunningHub 已受理但没有返回 taskId${tips ? `：${tips.slice(0, 240)}` : ''}`,
    })
  }
  return taskId
}

/**
 * 查一次任务（`POST /openapi/v2/query`）。
 *
 * 状态映射照真机：`SUCCESS` / `FAILED` / 其余（空串、`RUNNING`、`QUEUED`…）都算"还在跑"，
 * 由调用方决定继续轮询还是超时——这里不猜。
 */
export async function queryWorkflowTask(
  deps: Pick<PlatformKit, 'network'>,
  endpoint: WorkflowEndpoint,
  taskId: string,
  signal: AbortSignal,
): Promise<WorkflowTaskResult> {
  const res = await deps.network.request(
    {
      url: `${hostOf(endpoint)}${QUERY_PATH}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(endpoint.apiKey ? { Authorization: `Bearer ${endpoint.apiKey}` } : {}),
      },
      body: { taskId },
      timeoutMs: QUERY_TIMEOUT_MS,
    },
    signal,
  )
  const envelope = await readJson(res)
  if (res.status >= 400) throw httpError(res.status, await res.text())
  const status = (envelope.status ?? '').toUpperCase()
  const items = envelope.results ?? []
  const urls: string[] = []
  for (const item of items) {
    const url = item.url ?? item.outputUrl ?? item.fileUrl
    if (typeof url === 'string' && url.length > 0) urls.push(url)
  }
  const mapped: WorkflowTaskResult['status'] =
    status === 'SUCCESS' || status === 'FAILED' || status === 'RUNNING' || status === 'QUEUED'
      ? status
      : 'UNKNOWN'
  return {
    taskId: String(envelope.taskId ?? taskId),
    status: mapped,
    urls,
    errorCode: String(envelope.errorCode ?? ''),
    errorMessage: String(envelope.errorMessage ?? ''),
    ...(envelope.usage?.taskCostTime !== undefined
      ? { costSeconds: String(envelope.usage.taskCostTime) }
      : {}),
  }
}
