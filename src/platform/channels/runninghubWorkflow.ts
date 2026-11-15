import { parseAppMeta, parseAppNodeInfoList, type WorkflowAppMeta } from '../../domain/project/workflowAppParams'
import { parseWorkflowJsonToFields, type WorkflowParamField } from '../../domain/project/workflowParams'
import { buildWorkflowGraph, type WorkflowGraph } from '../../domain/project/workflowGraph'
import { prepareModelImageInput } from './chatImageInput'
import type { PlatformKit } from '../ports'
import { ChannelError } from './types'
import { uploadV2Binary } from './runninghubV2'
import { failureOf, hostOf, httpError, postJson, readJson, type WorkflowEndpoint } from './runninghubWorkflowHttp'

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
 * **2026-11-15 起提交与上传先走 v2 全 Bearer**（`runninghubV2.ts`，真机实测见那份文件头）：
 * `/openapi/v2/run/{workflow|ai-app}/{id}`、`/openapi/v2/media/upload/binary`；站点回
 * `1001 Invalid URL`（没有这条路由）时才退回上表的旧接口。取参（getJsonApiFormat / apiCallDemo）
 * 官方没有 v2 版本，仍走旧接口——请求体 / query 带 `apiKey`，Header 同时带 Bearer。
 */

const GET_JSON_PATH = '/api/openapi/getJsonApiFormat'
const APP_NODE_PATH = '/api/webapp/apiCallDemo'
const UPLOAD_PATH = '/task/openapi/upload'
const QUERY_PATH = '/openapi/v2/query'

const FETCH_TIMEOUT_MS = 30_000
const UPLOAD_TIMEOUT_MS = 120_000
const QUERY_TIMEOUT_MS = 30_000

export const WORKFLOW_POLL_INTERVAL_MS = 5_000
export const WORKFLOW_POLL_MAX_MS = 20 * 60_000

export type { WorkflowEndpoint } from './runninghubWorkflowHttp'

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
  const bundle = await fetchWorkflowBundle(deps, endpoint, workflowId, signal)
  return bundle.fields
}

/**
 * 一次拉齐「字段表 + 节点图」。
 *
 * 同一个响应里两样东西都在（`data.prompt` 就是整份图），分成两次请求纯属浪费；
 * 节点图给设置页画（#1116 ②），字段表给节点/暴露开关用。
 */
export async function fetchWorkflowBundle(
  deps: Pick<PlatformKit, 'network'>,
  endpoint: WorkflowEndpoint,
  workflowId: string,
  signal: AbortSignal,
): Promise<{ fields: WorkflowParamField[]; graph: WorkflowGraph }> {
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
  return { fields, graph: buildWorkflowGraph(workflowJson) }
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
      headers: endpoint.apiKey ? { Authorization: `Bearer ${endpoint.apiKey}` } : {},
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

/** 压缩后 mime 变了（png → webp）就把后缀一起改掉，别让服务端按 `.png` 去认一张 webp */
export function fileNameForMime(fileName: string, mime: string): string {
  const ext = mime === 'image/webp' ? 'webp' : mime === 'image/jpeg' ? 'jpg' : mime === 'image/png' ? 'png' : ''
  if (!ext) return fileName
  return /\.[a-z0-9]+$/i.test(fileName) ? fileName.replace(/\.[a-z0-9]+$/i, `.${ext}`) : `${fileName}.${ext}`
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
  /** 只有图片才走压缩（视频 / 音频送进图片解码器只会白费一次，#1126 L11）；文件名跟着真实 mime 改后缀 */
  const prepared = asset.mime.startsWith('image/')
    ? await prepareModelImageInput({ bytes: asset.bytes, mime: asset.mime })
    : { bytes: asset.bytes, mime: asset.mime }
  const name = fileNameForMime(fileName, prepared.mime)
  const blob = new Blob([new Uint8Array(prepared.bytes) as BlobPart], { type: prepared.mime })
  const viaV2 = await uploadV2Binary(deps, endpoint, blob, name, signal, UPLOAD_TIMEOUT_MS)
  if (viaV2) return viaV2
  const form = new FormData()
  form.append('file', blob, name)
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

export { submitAppTask, submitWorkflowTask, webappIdPayload } from './runninghubWorkflowSubmit'

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

