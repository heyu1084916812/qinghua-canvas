import type { NetworkResponse, PlatformKit } from '../ports'
import { ChannelError } from './types'
import { describeRhError } from './runninghubErrorText'

/**
 * RunningHub **v2 全 Bearer** 接口（对账 #1126，2026-11-15 国内站真机实测）。
 *
 * 为什么要有这一层：旧接口（`/task/openapi/create`、`/task/openapi/ai-app/run`、
 * `/task/openapi/upload`、`/api/openapi/getJsonApiFormat`、`/uc/openapi/accountStatus`）
 * **只认请求体里的 `apiKey`**——只带 `Authorization: Bearer` 会回
 * `301/1601 param apiKey is required`。v2 这一套只认 Header：
 *
 * | 用途 | 请求 | 实测（2026-11-15，国内站，只注入 Bearer） |
 * | --- | --- | --- |
 * | 跑工作流 | `POST /openapi/v2/run/workflow/{workflowId}` `{nodeInfoList, instanceType}` | 路由与鉴权通过，回 `errorCode 821`（账号无付费积分）|
 * | 跑 AI 应用 | `POST /openapi/v2/run/ai-app/{webappId}` `{nodeInfoList, instanceType}` | 同上 `821`；空 `nodeInfoList` 回 `1101` |
 * | 上传素材 | `POST /openapi/v2/media/upload/binary`（multipart `file`）→ `data.fileName` | ✅ `code:0`，`fileName: openapi/<sha>.png` |
 * | 查任务 | `POST /openapi/v2/query` `{taskId}` | ✅（`1004 Task not found`）|
 *
 * 提交体照官方 `aiapp/list` 返回的 `invokeExample`（RunningHub 自己生成的 curl）：
 * `{"nodeInfoList":[…], "instanceType":"default", "usePersonalQueue":"false"}`。
 *
 * ⚠️ **成功响应没真见过**（账号没有付费积分，提交全部停在 821）。v2 的失败形状与
 * `/openapi/v2/query` 同一套顶层 `{taskId, status, errorCode, errorMessage}`，所以 taskId
 * 两处都认（顶层与 `data.taskId`）。路由不存在时回 `1001 Invalid URL` —— **只有这一种**
 * 情况才退回旧接口：1001 说明请求根本没被受理，退回去不会重复扣费。
 */

const RUN_WORKFLOW = '/openapi/v2/run/workflow/'
const RUN_APP = '/openapi/v2/run/ai-app/'
const UPLOAD_BINARY = '/openapi/v2/media/upload/binary'

/** v2 「路由不存在」：退回旧接口的唯一信号 */
export const V2_ROUTE_MISSING = '1001'

export interface V2Endpoint {
  host: string
  apiKey: string
}

interface V2Envelope {
  code?: number | string
  msg?: string
  message?: string
  taskId?: string | number | null
  status?: string
  errorCode?: string | number | null
  errorMessage?: string
  promptTips?: unknown
  data?: { taskId?: string | number | null; fileName?: string; download_url?: string } | null
}

function hostOf(endpoint: V2Endpoint): string {
  return endpoint.host.replace(/\/+$/, '')
}

function bearer(endpoint: V2Endpoint): Record<string, string> {
  return endpoint.apiKey ? { Authorization: `Bearer ${endpoint.apiKey}` } : {}
}

async function envelopeOf(res: NetworkResponse): Promise<V2Envelope> {
  const text = await res.text()
  if (res.status === 404) return { errorCode: V2_ROUTE_MISSING, errorMessage: 'Not Found' }
  if (res.status >= 400) {
    throw new ChannelError({ kind: 'http', status: res.status, body: text.slice(0, 300) })
  }
  if (!text) return {}
  try {
    const parsed = JSON.parse(text) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as V2Envelope) : {}
  } catch {
    throw new ChannelError({ kind: 'parse', raw: `RunningHub 返回了非 JSON（HTTP ${res.status}）：${text.slice(0, 200)}` })
  }
}

function errorCodeOf(envelope: V2Envelope): string {
  const raw = envelope.errorCode ?? ''
  const text = String(raw).trim()
  return text === '0' ? '' : text
}

/** 顶层 `code`：非 0 才算错（成功的提交没有这一项，或是 0） */
function topLevelCodeOf(envelope: V2Envelope): string {
  const text = String(envelope.code ?? '').trim()
  return text === '' || text === '0' ? '' : text
}

export function isV2RouteMissing(envelope: { errorCode?: unknown }): boolean {
  return String(envelope.errorCode ?? '').trim() === V2_ROUTE_MISSING
}

/** v2 提交的结果：拿到 taskId，或"这个站没有这条路由"（调用方退回旧接口） */
export type V2SubmitOutcome = { taskId: string } | { routeMissing: true }

/**
 * 提交工作流 / 应用（v2，Bearer）。
 *
 * `instanceType`：v2 的 `invokeExample` 里应用与工作流都带这一项（`default`/`plus`），
 * 所以两种条目都透传——旧代码只在工作流上发、应用上不发（#1126 M1）。
 */
export async function submitV2Task(
  deps: Pick<PlatformKit, 'network'>,
  endpoint: V2Endpoint,
  input: {
    kind: 'workflow' | 'app'
    id: string
    nodeInfoList: { nodeId: string; fieldName: string; fieldValue: string }[]
    instanceType?: 'default' | 'plus' | 'ultra'
  },
  signal: AbortSignal,
  timeoutMs = 60_000,
): Promise<V2SubmitOutcome> {
  const path = `${input.kind === 'app' ? RUN_APP : RUN_WORKFLOW}${encodeURIComponent(input.id)}`
  /**
   * 工作流不改参数时**不发** `nodeInfoList`（与旧接口「简易式」同一口径）；应用一律发——
   * 实测应用收空列表回 `1101 节点信息异常`。工作流 v2 在余额校验之前不校验参数（id=1 也回 821），
   * 所以「空列表是否等于简易式」**未验证**，宁可不发。
   */
  const body: Record<string, unknown> =
    input.kind === 'app' || input.nodeInfoList.length > 0 ? { nodeInfoList: input.nodeInfoList } : {}
  if (input.instanceType && input.instanceType !== 'default') body.instanceType = input.instanceType
  const res = await deps.network.request(
    {
      url: `${hostOf(endpoint)}${path}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...bearer(endpoint) },
      body,
      timeoutMs,
    },
    signal,
  )
  const envelope = await envelopeOf(res)
  if (isV2RouteMissing(envelope)) return { routeMissing: true }
  /**
   * 两种失败形状都认：v2 顶层 `errorCode`（821 / 1101…），以及**鉴权网关**的 `{code:1602, msg}`
   * （#1128 实测：Key 没带上时回 `1602 HEADER_API_KEY_NOT_FOUND`，上一版当成「已受理没 taskId」，
   * 节点上只剩一句「结果暂时无法确认」）。这两种都说明**没受理**，不会扣费。
   */
  const taskId = String(envelope.taskId ?? envelope.data?.taskId ?? '').trim()
  /** 顶层 `code` 只在**没有 taskId** 时算错：成功形状没真见过，别把可能的 `code:200` 误判成失败 */
  const code = errorCodeOf(envelope) || (taskId ? '' : topLevelCodeOf(envelope))
  if (code) {
    const message = envelope.errorMessage || envelope.msg || envelope.message
    throw new ChannelError({
      kind: 'http',
      status: 400,
      body: describeRhError(
        { errorCode: code, ...(message ? { errorMessage: message } : {}) },
        `提交任务失败（${input.id}）`,
      ),
    })
  }
  if (!taskId) {
    const tips = typeof envelope.promptTips === 'string' ? envelope.promptTips : JSON.stringify(envelope.promptTips ?? '')
    throw new ChannelError({
      kind: 'http',
      status: 502,
      body: `RunningHub 已受理但没有返回 taskId${tips && tips !== '""' ? `：${tips.slice(0, 240)}` : ''}`,
    })
  }
  return { taskId }
}

/**
 * 上传素材（v2 二进制上传，Bearer）→ `fileName`；没有这条路由时回 `null`（调用方退回旧接口）。
 *
 * 返回的 `fileName` 形如 `openapi/<sha>.png`，ComfyUI 的 LoadImage / LoadVideo 直接吃它
 * （官方文档 api-425749007：「download_url 用于标准模型 API，fileName 用于 comfyUI 节点」）。
 */
export async function uploadV2Binary(
  deps: Pick<PlatformKit, 'network'>,
  endpoint: V2Endpoint,
  file: Blob,
  fileName: string,
  signal: AbortSignal,
  timeoutMs = 120_000,
): Promise<string | null> {
  const form = new FormData()
  form.append('file', file, fileName)
  const res = await deps.network.request(
    { url: `${hostOf(endpoint)}${UPLOAD_BINARY}`, method: 'POST', headers: bearer(endpoint), body: form, timeoutMs },
    signal,
  )
  const envelope = await envelopeOf(res)
  if (isV2RouteMissing(envelope)) return null
  const name = envelope.data?.fileName
  const ok = (envelope.code === 0 || envelope.code === '0') && typeof name === 'string' && name.length > 0
  if (!ok) {
    throw new ChannelError({
      kind: 'http',
      status: 400,
      body: describeRhError(
        { ...(envelope.code !== undefined ? { code: Number(envelope.code) } : {}), msg: envelope.msg ?? envelope.message ?? '', errorCode: errorCodeOf(envelope), errorMessage: envelope.errorMessage ?? '' },
        '素材上传失败',
      ),
    })
  }
  return name
}
