import type { NetworkResponse, PlatformKit } from '../ports'
import { ChannelError } from './types'

/**
 * RunningHub 工作流 / 应用旧接口共用的 HTTP 小件（读 JSON、错误归一、带 Bearer 的 POST）。
 *
 * 从 `runninghubWorkflow.ts` 拆出（对账 #1126）：那份贴着 450 行上限，提交路径挪到
 * `runninghubWorkflowSubmit.ts` 后两边都要用这几件；单独一份避免两个模块互相引用。
 */

export interface WorkflowEndpoint {
  /** 基址，如 `https://www.runninghub.cn`（渠道里可改） */
  host: string
  apiKey: string
}

export interface RhEnvelope {
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

export function hostOf(endpoint: WorkflowEndpoint): string {
  return endpoint.host.replace(/\/+$/, '')
}

export async function readJson(res: NetworkResponse): Promise<RhEnvelope> {
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
export function failureOf(envelope: RhEnvelope, fallback: string): string {
  const message = envelope.errorMessage || envelope.msg || envelope.message || fallback
  const code = String(envelope.errorCode ?? envelope.code ?? '')
  return code ? `${message}（${code}）` : message
}

export function httpError(status: number, body: string): ChannelError {
  return new ChannelError({
    kind: 'http',
    status: status >= 400 ? status : 502,
    body: body.slice(0, 300),
  })
}

export async function postJson(
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

