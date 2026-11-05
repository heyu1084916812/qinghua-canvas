import type { ImageParamSpec } from '../../../domain/canvas/layout/imageParams'
import { customImageSize } from '../../../domain/canvas/layout/customSize'
import { errorTextOf } from '../../../shared/result'
import {
  authHeader,
  IMAGE_GENERATE_TIMEOUT_MS,
  IMAGE_TASK_POLL_TIMEOUT_MS,
} from '../openaiCommon'
import { ChannelError, type GeneratedAsset, type ImageRunRequest } from '../types'
import type {
  AssetWriter,
  OpenAiImagesCore,
  SoonStudioSubmissionInput,
} from './contracts'
import {
  acceptedAfterSubmit,
  isGeminiNativeRequestRequired,
  soonStudioFailureIn,
  soonStudioUpstreamErrorIn,
  textField,
  transportTextOf,
} from './errorNormalization'
import { openAiImageSize, sizeToDimensions } from './imageParams'
import { imageItemsIn } from './responseParsing'

interface SoonStudioAsyncRef {
  id: string
  pollUrl: string | null
}

export interface SoonStudioPorts {
  nativeGeminiFallback(
    request: ImageRunRequest,
    spec: ImageParamSpec,
    signal: AbortSignal,
  ): Promise<GeneratedAsset[] | null>
}

function soonStudioAsyncRefIn(value: unknown): SoonStudioAsyncRef | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const id =
    textField(row.task_id) ??
    textField(row.taskId) ??
    textField(row.jobId) ??
    textField(row.job_id)
  const pollUrl = textField(row.pollUrl) ?? textField(row.poll_url)
  if (id) return { id, pollUrl }
  if (typeof row.data === 'string' && /^[A-Za-z0-9_-]{8,}$/.test(row.data.trim())) {
    return { id: row.data.trim(), pollUrl }
  }
  if (row.data && typeof row.data === 'object') {
    const nested = row.data as Record<string, unknown>
    const nestedId =
      textField(nested.task_id) ??
      textField(nested.taskId) ??
      textField(nested.jobId) ??
      textField(nested.job_id)
    const nestedPollUrl = textField(nested.pollUrl) ?? textField(nested.poll_url)
    if (nestedId) return { id: nestedId, pollUrl: nestedPollUrl ?? pollUrl }
  }
  return null
}

function soonStudioPollUrl(base: string, ref: SoonStudioAsyncRef): string {
  if (ref.pollUrl) {
    try {
      return new URL(ref.pollUrl, `${new URL(base).origin}/`).toString()
    } catch {
      return ref.pollUrl
    }
  }
  return `${base}/images/tasks/${encodeURIComponent(ref.id)}`
}

function soonStudioCompletedTaskIdIn(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const root = value as Record<string, unknown>
  const response =
    root.response && typeof root.response === 'object'
      ? (root.response as Record<string, unknown>)
      : null
  const body =
    response?.body && typeof response.body === 'object'
      ? (response.body as Record<string, unknown>)
      : null
  const nested =
    body?.data && typeof body.data === 'object'
      ? (body.data as Record<string, unknown>)
      : null
  return (
    textField(body?.task_id) ??
    textField(body?.taskId) ??
    textField(nested?.task_id) ??
    textField(nested?.taskId) ??
    textField(root.task_id) ??
    textField(root.taskId)
  )
}

function soonStudioStatusIn(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  const root = value as Record<string, unknown>
  const data =
    root.data && typeof root.data === 'object'
      ? (root.data as Record<string, unknown>)
      : null
  return String(root.status ?? data?.status ?? '').trim().toUpperCase()
}

export function soonStudioSubmitRequest(
  core: Pick<OpenAiImagesCore, 'config' | 'imagesUrl' | 'editsUrl'>,
  input: SoonStudioSubmissionInput,
) {
  const { request, count, size, quality, background, spec, files } = input
  const resolution =
    typeof request.params.resolution === 'string' ? request.params.resolution.trim() : ''
  const isGemini = spec?.dialect === 'gemini'
  const ratio =
    isGemini && typeof request.params.ratio === 'string'
      ? request.params.ratio.trim()
      : ''
  const imageSize =
    isGemini && typeof request.params.resolution === 'string'
      ? request.params.resolution.trim().toUpperCase()
      : ''
  const geminiFields = {
    ...(ratio ? { aspect_ratio: ratio } : {}),
    ...(imageSize ? { image_size: imageSize } : {}),
  }
  const form = files.length > 0 ? new FormData() : null
  if (form) {
    form.append('model', request.model)
    form.append('prompt', request.prompt)
    form.append('n', String(count))
    form.append('response_format', 'url')
    if (size && !isGemini) form.append('size', size)
    if (quality) form.append('quality', quality)
    if (background) form.append('background', background)
    for (const [key, value] of Object.entries(geminiFields)) form.append(key, value)
    for (const file of files) form.append('image', file.blob, file.name)
  }
  return {
    resolution,
    requested: sizeToDimensions(
      size ?? customImageSize(resolution) ?? openAiImageSize(request.params.ratio, resolution),
    ),
    request: {
      url: `${form ? core.editsUrl : core.imagesUrl}?async=true`,
      method: 'POST' as const,
      headers: form
        ? { Prefer: 'respond-async', ...authHeader(core.config.apiKey) }
        : {
            'Content-Type': 'application/json',
            Prefer: 'respond-async',
            ...authHeader(core.config.apiKey),
          },
      body:
        form ??
        ({
          model: request.model,
          prompt: request.prompt,
          n: count,
          response_format: 'url',
          ...(size && !isGemini ? { size } : {}),
          ...(quality ? { quality } : {}),
          ...(background ? { background } : {}),
          ...geminiFields,
        } satisfies Record<string, unknown>),
      timeoutMs: IMAGE_GENERATE_TIMEOUT_MS,
    },
  }
}

export async function generateSoonStudioImage(
  core: OpenAiImagesCore,
  assets: AssetWriter,
  ports: SoonStudioPorts,
  input: SoonStudioSubmissionInput,
  signal: AbortSignal,
): Promise<GeneratedAsset[]> {
  const submission = soonStudioSubmitRequest(core, input)
  const request = input.request
  const spec = input.spec
  const isGemini = spec?.dialect === 'gemini'
  let res
  try {
    res = await core.deps.network.request(submission.request, signal)
  } catch (e) {
    if (signal.aborted) throw e
    throw acceptedAfterSubmit(`生图提交结果未知：${errorTextOf(e)}`)
  }
  if (res.status < 200 || res.status >= 300) {
    const detail = await res.text().catch(() => '')
    if (res.status === 408 || res.status === 429 || res.status >= 500) {
      throw acceptedAfterSubmit(`生图提交结果未知：HTTP ${res.status} ${detail}`)
    }
    throw new ChannelError({
      kind: 'http',
      status: res.status,
      body: detail,
      verbatim: true,
    })
  }
  const createdRaw = await res.text()
  let created: unknown
  try {
    created = JSON.parse(createdRaw) as unknown
  } catch {
    throw acceptedAfterSubmit(`生图任务已提交，但响应无法解析：${createdRaw.slice(0, 300)}`)
  }
  const createdError = soonStudioUpstreamErrorIn(created)
  if (createdError) {
    if (isGemini && spec && isGeminiNativeRequestRequired(createdError)) {
      const nativeAssets = await ports.nativeGeminiFallback(request, spec, signal)
      if (nativeAssets) return nativeAssets
    }
    throw new ChannelError({
      kind: 'http',
      status: 400,
      body: createdError,
      verbatim: true,
    })
  }
  const immediate = imageItemsIn(created)
  if (immediate.length > 0) {
    return assets.assetsFromItems(immediate, submission.requested, signal)
  }

  const asyncRef = soonStudioAsyncRefIn(created)
  if (!asyncRef) {
    throw acceptedAfterSubmit(`生图任务已提交，但响应里没有任务号：${createdRaw.slice(0, 300)}`)
  }
  const taskId = asyncRef.id
  let pollUrl = soonStudioPollUrl(core.base, asyncRef)
  let delegatedTaskId = ''
  let lastResponse = ''
  let lastTransport = ''
  const startedAt = core.now()
  for (
    let attempt = 0;
    attempt < core.maxPolls && core.now() - startedAt < core.pollTimeout;
    attempt += 1
  ) {
    if (attempt > 0) await core.sleepFn(core.pollInterval, signal)
    let poll
    try {
      poll = await core.deps.network.request(
        {
          url: pollUrl,
          method: 'GET',
          headers: authHeader(core.config.apiKey),
          timeoutMs: IMAGE_TASK_POLL_TIMEOUT_MS,
        },
        signal,
      )
    } catch (e) {
      if (signal.aborted) throw e
      lastTransport = transportTextOf(e)
      continue
    }
    if (poll.status < 200 || poll.status >= 300) {
      const detail = await poll.text().catch(() => '')
      lastResponse = detail || lastResponse
      if (poll.status === 408 || poll.status === 429 || poll.status >= 500) continue
      throw acceptedAfterSubmit(
        `生图任务 ${taskId} 已提交，后续查询失败：HTTP ${poll.status} ${detail}`,
      )
    }
    const raw = await poll.text()
    let body: unknown
    try {
      body = JSON.parse(raw) as unknown
    } catch {
      throw acceptedAfterSubmit(`生图任务 ${taskId} 已提交，但查询响应无法解析：${raw.slice(0, 300)}`)
    }
    lastResponse = raw
    const failure = soonStudioFailureIn(body)
    if (failure) {
      if (isGemini && spec && isGeminiNativeRequestRequired(failure)) {
        const nativeAssets = await ports.nativeGeminiFallback(request, spec, signal)
        if (nativeAssets) return nativeAssets
      }
      throw acceptedAfterSubmit(`生图任务 ${taskId} 已提交但失败：${failure}`)
    }
    const upstreamError = soonStudioUpstreamErrorIn(body)
    if (upstreamError) {
      if (isGemini && spec && isGeminiNativeRequestRequired(upstreamError)) {
        const nativeAssets = await ports.nativeGeminiFallback(request, spec, signal)
        if (nativeAssets) return nativeAssets
      }
      throw new ChannelError({
        kind: 'http',
        status: 400,
        body: upstreamError,
        verbatim: true,
      })
    }
    const items = imageItemsIn(body)
    if (items.length > 0) {
      return assets.assetsFromItems(items, submission.requested, signal)
    }
    const status = soonStudioStatusIn(body)
    if (
      !delegatedTaskId &&
      ['COMPLETED', 'SUCCESS', 'SUCCEEDED', 'DONE'].includes(status)
    ) {
      const innerTaskId = soonStudioCompletedTaskIdIn(body)
      if (!innerTaskId) {
        throw acceptedAfterSubmit(
          `生图任务 ${taskId} 已完成，但响应里没有可查询的结果任务号：${raw.slice(0, 300)}`,
        )
      }
      delegatedTaskId = innerTaskId
      /**
       * 外层 COMPLETED 只给结果任务号，图片还在 /images/tasks/:innerTaskId。
       * 停在外层继续轮询会把「已完成」误报成超时。
       */
      pollUrl = `${core.base}/images/tasks/${encodeURIComponent(innerTaskId)}`
    }
  }
  throw acceptedAfterSubmit(
    `生图任务 ${taskId} 已提交${
      delegatedTaskId ? `，结果任务 ${delegatedTaskId}` : ''
    }，但轮询超时或结果未知：${lastResponse || lastTransport || '无响应'}`,
  )
}
