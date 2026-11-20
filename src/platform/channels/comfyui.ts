import { fingerprintBytes } from '../../domain/shared/hash'
import { imageSizeFromHeader } from '../../domain/shared/imageSize'
import type { ModelCapability } from '../../domain/shared/capability'
import type { SafeChannelConfig } from '../ports'
import { ChannelError, type ChannelAdapter, type ChannelDeps, type GeneratedAsset, type ImageRunRequest, type VideoRunRequest, type VerifyResult } from './types'
import { applyWorkflowNodeInfo } from '../../domain/project/workflowGraph'
import { submitComfyPrompt, queryComfyHistory, type ComfyWorkflowEndpoint, type ComfyPromptBody } from './comfyWorkflow'

export interface ComfyUiAdapterOptions {
  pollIntervalMs?: number
  pollTimeoutMs?: number
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
  now?: () => number
}

const DEFAULT_POLL_INTERVAL_MS = 500
const DEFAULT_POLL_TIMEOUT_MS = 180_000
const defaultSleep = (ms: number, signal: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
  const timer = setTimeout(resolve, ms)
  signal.addEventListener('abort', () => { clearTimeout(timer); reject(new ChannelError({ kind: 'network', detail: 'aborted' })) }, { once: true })
})

function endpointOf(config: SafeChannelConfig): ComfyWorkflowEndpoint {
  const baseUrl = config.baseUrl.trim().replace(/\/+$/, '')
  if (!baseUrl) throw new ChannelError({ kind: 'channel', detail: 'missingChannel' })
  return { baseUrl }
}

function jsonOf(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw
  try { return JSON.parse(raw) as unknown } catch { return undefined }
}

function graphOf(request: ImageRunRequest | VideoRunRequest): Record<string, unknown> {
  const raw = request.params.workflowJson ?? request.params.workflow
  const graph = jsonOf(raw)
  if (!graph || typeof graph !== 'object' || Array.isArray(graph)) {
    throw new ChannelError({ kind: 'channel', detail: 'missingModel' })
  }
  const values = request.params.workflowNodeInfoList ?? (Array.isArray(request.params.workflow) ? request.params.workflow : [])
  return applyWorkflowNodeInfo(graph, Array.isArray(values) ? values.filter((item): item is { nodeId: string; fieldName: string; fieldValue: string } => {
    if (!item || typeof item !== 'object') return false
    const v = item as Record<string, unknown>
    return typeof v.nodeId === 'string' && typeof v.fieldName === 'string' && (typeof v.fieldValue === 'string' || typeof v.fieldValue === 'number')
  }).map((item) => ({ nodeId: item.nodeId, fieldName: item.fieldName, fieldValue: String(item.fieldValue) })) : [])
}

function contentTypeOf(headers: Record<string, string>, fallback: string): string {
  const value = Object.entries(headers).find(([key]) => key.toLowerCase() === 'content-type')?.[1]
  return value?.split(';', 1)[0]?.trim() || fallback
}

export function createComfyUiAdapter(config: SafeChannelConfig, deps: ChannelDeps, options: ComfyUiAdapterOptions = {}): ChannelAdapter {
  const endpoint = endpointOf(config)
  const pollInterval = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  const pollTimeout = options.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS
  const sleep = options.sleep ?? defaultSleep
  const now = options.now ?? (() => Date.now())

  const verify = async (_cfg: SafeChannelConfig, signal: AbortSignal): Promise<VerifyResult> => {
    try {
      const response = await deps.network.request({ url: `${endpoint.baseUrl}/system_stats`, method: 'GET', headers: {}, timeoutMs: 15_000, publicOnly: false }, signal)
      if (response.status < 200 || response.status >= 300) return { ok: false, error: { kind: 'http', status: response.status, body: await response.text().catch(() => '') } }
      return { ok: true, models: [], note: 'ComfyUI 本地服务已连接；模型目录由工作流决定。' }
    } catch (error) {
      if (error instanceof ChannelError) return { ok: false, error: error.appError }
      return { ok: false, error: { kind: 'network', detail: 'dns' } }
    }
  }

  const listModels = async (): Promise<ModelCapability[]> => []

  const generate = async (request: ImageRunRequest | VideoRunRequest, signal: AbortSignal): Promise<GeneratedAsset[]> => {
    if (request.inputs.some((input) => input.kind === 'asset')) {
      throw new ChannelError({ kind: 'channel', detail: 'unsupported' })
    }
    const prompt = graphOf(request)
    const accepted = await submitComfyPrompt(deps.network, endpoint, { prompt: prompt as ComfyPromptBody['prompt'], client_id: endpoint.clientId }, signal)
    const deadline = now() + Math.max(1, request.timeoutMs ?? pollTimeout)
    let history = await queryComfyHistory(deps.network, endpoint, accepted.promptId, signal)
    while (history.status === 'running' || history.status === 'unknown') {
      if (now() >= deadline) throw new ChannelError({ kind: 'network', detail: 'timeout' })
      await sleep(pollInterval, signal)
      history = await queryComfyHistory(deps.network, endpoint, accepted.promptId, signal)
    }
    if (history.status === 'error') throw new ChannelError({ kind: 'execution', detail: 'accepted', message: history.error || `ComfyUI 任务 ${accepted.promptId} 失败` })
    const assets: GeneratedAsset[] = []
    for (const output of history.outputs) {
      const response = await deps.network.request({ url: output.url, method: 'GET', headers: {}, timeoutMs: 30_000, publicOnly: false }, signal)
      if (response.status < 200 || response.status >= 300) continue
      const bytes = new Uint8Array(await response.arrayBuffer())
      const mime = contentTypeOf(response.headers, request.kind === 'video' ? 'video/mp4' : 'image/png')
      const size = request.kind === 'image' ? imageSizeFromHeader(bytes) : undefined
      assets.push({ hash: await fingerprintBytes(bytes), mime, bytes, ...(size ? { width: size.width, height: size.height } : {}) })
    }
    return assets
  }

  return {
    protocol: config.protocol,
    verify,
    listModels,
    generateImage: (request, signal) => generate(request, signal),
    generateVideo: (request, signal) => generate(request, signal),
    async completeText(): Promise<never> { throw new ChannelError({ kind: 'channel', detail: 'unsupported' }) },
  }
}