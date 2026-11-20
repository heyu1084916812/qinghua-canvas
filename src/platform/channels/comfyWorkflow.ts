import type { NetworkPort } from '../ports'
import { ChannelError } from './types'

/** 本地 ComfyUI HTTP 工作流的最小传输契约（不把节点 schema 假装成模型目录）。 */
export interface ComfyWorkflowEndpoint { baseUrl: string; clientId?: string }
export interface ComfyPromptBody { prompt: Record<string, { class_type: string; inputs: Record<string, unknown> }>; client_id?: string; extra_data?: Record<string, unknown> }
export interface ComfyPromptAccepted { promptId: string; number?: number; nodeErrors?: unknown }
export interface ComfyHistoryOutput { filename: string; subfolder: string; type: string; url: string }
export interface ComfyHistoryResult { status: 'success' | 'error' | 'running' | 'unknown'; outputs: ComfyHistoryOutput[]; error?: string }
function baseUrlOf(endpoint: ComfyWorkflowEndpoint): string { return endpoint.baseUrl.replace(/\/+$/, '') }
function urlOf(endpoint: ComfyWorkflowEndpoint, path: string): string { return `${baseUrlOf(endpoint)}${path}` }
function textOf(value: unknown): string { return typeof value === 'string' ? value : '' }
export function parseComfyPromptAccepted(raw: unknown): ComfyPromptAccepted {
  if (!raw || typeof raw !== 'object') throw new ChannelError({ kind: 'parse', raw: 'ComfyUI /prompt 返回不是对象' })
  const value = raw as Record<string, unknown>
  const promptId = textOf(value.prompt_id).trim()
  if (!promptId) throw new ChannelError({ kind: 'parse', raw: 'ComfyUI /prompt 缺少 prompt_id' })
  return { promptId, number: typeof value.number === 'number' ? value.number : undefined, nodeErrors: value.node_errors }
}
export function parseComfyHistory(raw: unknown, promptId: string, endpoint: ComfyWorkflowEndpoint): ComfyHistoryResult {
  if (!raw || typeof raw !== 'object') return { status: 'unknown', outputs: [] }
  const record = raw as Record<string, unknown>
  const item = record[promptId] && typeof record[promptId] === 'object' ? record[promptId] as Record<string, unknown> : record
  const statusRecord = item.status && typeof item.status === 'object' ? item.status as Record<string, unknown> : null
  const statusText = textOf(statusRecord?.status_str || statusRecord?.status).toLowerCase()
  const status: ComfyHistoryResult['status'] = statusText === 'success' ? 'success' : statusText === 'error' ? 'error' : statusText === 'running' ? 'running' : 'unknown'
  const outputs: ComfyHistoryOutput[] = []
  const rawOutputs = item.outputs && typeof item.outputs === 'object' ? item.outputs as Record<string, unknown> : {}
  for (const node of Object.values(rawOutputs)) {
    if (!node || typeof node !== 'object') continue
    const candidateImages = (node as Record<string, unknown>).images
    const images: unknown[] = Array.isArray(candidateImages) ? candidateImages : []
    for (const image of images) {
      if (!image || typeof image !== 'object') continue
      const value = image as Record<string, unknown>
      const filename = textOf(value.filename).trim()
      if (!filename) continue
      const subfolder = textOf(value.subfolder)
      const type = textOf(value.type) || 'output'
      const params = new URLSearchParams({ filename, subfolder, type })
      outputs.push({ filename, subfolder, type, url: urlOf(endpoint, `/view?${params.toString()}`) })
    }
  }
  const error = textOf(statusRecord?.messages || statusRecord?.error)
  return { status, outputs, error: error || undefined }
}
export async function submitComfyPrompt(network: NetworkPort, endpoint: ComfyWorkflowEndpoint, body: ComfyPromptBody, signal: AbortSignal): Promise<ComfyPromptAccepted> {
  const response = await network.request({ url: urlOf(endpoint, '/prompt'), method: 'POST', headers: { 'content-type': 'application/json' }, body, timeoutMs: 30_000, publicOnly: false }, signal)
  return parseComfyPromptAccepted(await response.json())
}
export async function queryComfyHistory(network: NetworkPort, endpoint: ComfyWorkflowEndpoint, promptId: string, signal: AbortSignal): Promise<ComfyHistoryResult> {
  const response = await network.request({ url: urlOf(endpoint, `/history/${encodeURIComponent(promptId)}`), method: 'GET', headers: {}, timeoutMs: 30_000, publicOnly: false }, signal)
  return parseComfyHistory(await response.json(), promptId, endpoint)
}

/** ComfyUI `/upload/image` 的返回文件名；只接受相对文件名，避免把服务端响应变成任意路径。 */
export async function uploadComfyImage(network: NetworkPort, endpoint: ComfyWorkflowEndpoint, file: { bytes: Uint8Array; mime: string; name: string }, signal: AbortSignal): Promise<string> {
  const name = file.name.split('').map((char) => { const code = char.charCodeAt(0); return code < 32 || '\\/:*?"<>|'.includes(char) ? '_' : char }).join('').trim() || 'input.bin'
  const form = new FormData()
  form.append('image', new Blob([file.bytes.buffer as ArrayBuffer], { type: file.mime || 'application/octet-stream' }), name)
  form.append('type', 'input')
  form.append('overwrite', 'true')
  const response = await network.request({ url: urlOf(endpoint, '/upload/image'), method: 'POST', headers: {}, body: form, timeoutMs: 30_000, publicOnly: false }, signal)
  const raw = await response.json()
  if (!raw || typeof raw !== 'object') throw new ChannelError({ kind: 'parse', raw: 'ComfyUI /upload/image 返回不是对象' })
  const value = raw as Record<string, unknown>
  const uploaded = textOf(value.name).trim()
  const subfolder = textOf(value.subfolder).trim()
  if (!uploaded || uploaded.includes('..') || [...uploaded].some((char) => char.charCodeAt(0) < 32 || char === '\\')) throw new ChannelError({ kind: 'parse', raw: 'ComfyUI /upload/image 返回了非法文件名' })
  return subfolder ? `${subfolder.replace(/^\/+|\/+$/g, '')}/${uploaded}` : uploaded
}