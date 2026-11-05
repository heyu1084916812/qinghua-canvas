import { imageInputsOf } from '../../../domain/shared/execution/inputs'
import type { ImageParamSpec } from '../../../domain/canvas/layout/imageParams'
import { imageParamsFor } from '../../../domain/canvas/layout/imageParams'
import { mjFlags } from '../../../domain/canvas/layout/mjParams'
import { customImageSize } from '../../../domain/canvas/layout/customSize'
import { bytesToBase64 } from '../base64'
import { prepareModelImageInput } from '../chatImageInput'
import {
  authHeader,
  fileExtensionOf,
  IMAGE_GENERATE_TIMEOUT_MS,
} from '../openaiCommon'
import type { ImageRunRequest } from '../types'
import type {
  ImageFile,
  InlineImage,
  OpenAiImagesCore,
} from './contracts'
import { GEMINI_DEFAULT_RATIO, openAiImageQuality, openAiImageSize, specImageSize } from './imageParams'

export interface PreparedImageRequest {
  request: ImageRunRequest
  spec: ImageParamSpec | null
  openAiStyle: boolean
  count: number
  size: string | null
  specSize: string | null
  quality: string | null
  background: string | null
  files: ImageFile[]
}

export interface GeminiNativeRequestShape {
  url: string
  headers: Record<string, string>
  body: Record<string, unknown>
  timeoutMs: number
}

export async function readImageFiles(
  core: Pick<OpenAiImagesCore, 'deps'>,
  request: ImageRunRequest,
): Promise<ImageFile[]> {
  const wanted = imageInputsOf(request.inputs)
  if (wanted.length === 0) return []
  const files: ImageFile[] = []
  for (const item of wanted) {
    const payload = await core.deps.assets.read(item.assetHash)
    if (!payload) continue
    const prepared = await prepareModelImageInput({
      bytes: payload.bytes,
      mime: payload.mime,
    })
    const copy = new Uint8Array(prepared.bytes)
    files.push({
      blob: new Blob([copy as BlobPart], { type: prepared.mime }),
      name: `${item.assetHash.slice(0, 12)}.${fileExtensionOf(prepared.mime)}`,
    })
  }
  return files
}

export function postEdits(
  core: Pick<
    OpenAiImagesCore,
    'config' | 'deps' | 'editsUrl' | 'imageResponseFormat'
  >,
  request: ImageRunRequest,
  count: number,
  size: string | null,
  quality: string | null,
  background: string | null,
  files: readonly ImageFile[],
  signal: AbortSignal,
) {
  const form = new FormData()
  form.append('model', request.model)
  form.append('prompt', request.prompt)
  form.append('n', String(count))
  if (size) form.append('size', size)
  if (quality) form.append('quality', quality)
  if (background) form.append('background', background)
  form.append('response_format', core.imageResponseFormat)
  for (const f of files) form.append('image', f.blob, f.name)
  return core.deps.network.request(
    {
      url: core.editsUrl,
      method: 'POST',
      headers: { ...authHeader(core.config.apiKey) },
      body: form,
      timeoutMs: IMAGE_GENERATE_TIMEOUT_MS,
    },
    signal,
  )
}

export function postGenerations(
  core: Pick<
    OpenAiImagesCore,
    'config' | 'deps' | 'imagesUrl' | 'imageResponseFormat'
  >,
  request: ImageRunRequest,
  count: number,
  size: string | null,
  quality: string | null,
  background: string | null,
  signal: AbortSignal,
) {
  return core.deps.network.request(
    {
      url: core.imagesUrl,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeader(core.config.apiKey),
      },
      body: {
        model: request.model,
        prompt: request.prompt,
        n: count,
        ...(size ? { size } : {}),
        ...(quality ? { quality } : {}),
        ...(background ? { background } : {}),
        response_format: core.imageResponseFormat,
      },
      timeoutMs: IMAGE_GENERATE_TIMEOUT_MS,
    },
    signal,
  )
}

export function postSpecGenerations(
  core: Pick<
    OpenAiImagesCore,
    'config' | 'deps' | 'imagesUrl' | 'imageResponseFormat'
  >,
  request: ImageRunRequest,
  size: string,
  spec: ImageParamSpec,
  images: readonly string[],
  signal: AbortSignal,
) {
  const wantedRatio = typeof request.params.ratio === 'string' ? request.params.ratio : ''
  const ratio = spec.ratios.includes(wantedRatio) ? wantedRatio : spec.ratios[0]
  return core.deps.network.request(
    {
      url: core.imagesUrl,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeader(core.config.apiKey),
      },
      body: {
        model: request.model,
        prompt: request.prompt,
        size,
        ...(spec.dialect === 'tier' && ratio ? { ratio } : {}),
        ...(images.length > 0 ? { image: images } : {}),
        response_format: core.imageResponseFormat,
      },
      timeoutMs: IMAGE_GENERATE_TIMEOUT_MS,
    },
    signal,
  )
}

export async function toDataUris(
  core: Pick<OpenAiImagesCore, 'deps'>,
  request: ImageRunRequest,
): Promise<string[]> {
  const out: string[] = []
  for (const item of imageInputsOf(request.inputs)) {
    const payload = await core.deps.assets.read(item.assetHash).catch(() => null)
    if (!payload || payload.bytes.length === 0) continue
    const prepared = await prepareModelImageInput({
      bytes: payload.bytes,
      mime: payload.mime || item.mime,
    })
    out.push(`data:${prepared.mime};base64,${bytesToBase64(prepared.bytes)}`)
  }
  return out
}

export async function toInlineImages(
  core: Pick<OpenAiImagesCore, 'deps'>,
  request: ImageRunRequest,
): Promise<InlineImage[]> {
  /**
   * Gemini 原生端点要求每个参考图都是独立 inlineData part。这里少一段
   * 就会静默变成「只按提示词重画」，且耗时更短，极难从 UI 发现。
   */
  const out: InlineImage[] = []
  for (const item of imageInputsOf(request.inputs)) {
    const payload = await core.deps.assets.read(item.assetHash).catch(() => null)
    if (!payload || payload.bytes.length === 0) continue
    const prepared = await prepareModelImageInput({
      bytes: payload.bytes,
      mime: payload.mime || item.mime,
    })
    out.push({ mimeType: prepared.mime, data: bytesToBase64(prepared.bytes) })
  }
  return out
}

export function geminiNativeRequestShape(
  core: Pick<OpenAiImagesCore, 'base' | 'config'>,
  request: ImageRunRequest,
  spec: ImageParamSpec,
  inlineImages: readonly InlineImage[],
): GeminiNativeRequestShape {
  const wantedRatio = typeof request.params.ratio === 'string' ? request.params.ratio : ''
  const ratio = spec.ratios.includes(wantedRatio) ? wantedRatio : GEMINI_DEFAULT_RATIO
  const sendRatio = ratio === GEMINI_DEFAULT_RATIO ? null : ratio
  const wantedSize = String(request.params.resolution ?? '').toUpperCase()
  const imageSize =
    spec.sizes.find((candidate) => candidate.toUpperCase() === wantedSize) ??
    spec.sizes[0]
  const root = core.base.replace(/\/v1$/, '')
  return {
    url: `${root}/v1beta/models/${encodeURIComponent(request.model)}:generateContent`,
    headers: {
      'Content-Type': 'application/json',
      ...authHeader(core.config.apiKey),
    },
    body: {
      contents: [
        {
          parts: [
            { text: request.prompt },
            ...inlineImages.map((image) => ({ inlineData: image })),
          ],
        },
      ],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
        ...(sendRatio || imageSize
          ? {
              imageConfig: {
                ...(sendRatio ? { aspectRatio: sendRatio } : {}),
                ...(imageSize ? { imageSize } : {}),
              },
            }
          : {}),
      },
    },
    timeoutMs: IMAGE_GENERATE_TIMEOUT_MS,
  }
}

export function geminiImageSize(spec: ImageParamSpec, request: ImageRunRequest): string {
  const wantedSize = String(request.params.resolution ?? '').toUpperCase()
  return spec.sizes.find((candidate) => candidate.toUpperCase() === wantedSize) ?? spec.sizes[0]
}

export function geminiRequestOptions(
  spec: ImageParamSpec,
  request: ImageRunRequest,
): {
  ratio: string
  sendRatio: string | null
  imageSize: string
  quality: string | null
  background: string | null
} {
  const wantedRatio = typeof request.params.ratio === 'string' ? request.params.ratio : ''
  const ratio = spec.ratios.includes(wantedRatio) ? wantedRatio : GEMINI_DEFAULT_RATIO
  const sendRatio = ratio === GEMINI_DEFAULT_RATIO ? null : ratio
  const rawBackground =
    typeof request.params.background === 'string' ? request.params.background : ''
  const background =
    rawBackground &&
    rawBackground !== 'auto' &&
    spec.backgrounds.includes(rawBackground)
      ? rawBackground
      : null
  return {
    ratio,
    sendRatio,
    imageSize: geminiImageSize(spec, request),
    quality: openAiImageQuality(request.params.quality, spec.qualities),
    background,
  }
}

export async function prepareImageRequest(
  core: Pick<OpenAiImagesCore, 'deps' | 'config'>,
  request: ImageRunRequest,
  readFiles: boolean,
): Promise<PreparedImageRequest> {
  const spec = imageParamsFor(request.model) ?? null
  const openAiStyle =
    !spec || spec.dialect === 'openai-images' || spec.dialect === 'midjourney'
  const maxCount = spec ? Math.max(...spec.counts) : Number.POSITIVE_INFINITY
  const count = Math.min(
    maxCount,
    Math.max(1, typeof request.params.count === 'number' ? request.params.count : 1),
  )
  const specSize =
    spec && spec.dialect !== 'openai-images'
      ? specImageSize(request.params.resolution, spec)
      : (customImageSize(request.params.resolution) ??
        openAiImageSize(request.params.ratio, request.params.resolution))
  const size = specSize === 'auto' ? null : specSize
  const rawBackground =
    typeof request.params.background === 'string' ? request.params.background : ''
  const background =
    rawBackground &&
    rawBackground !== 'auto' &&
    (spec ? spec.backgrounds : ['transparent']).includes(rawBackground)
      ? rawBackground
      : null
  const quality = spec
    ? openAiImageQuality(request.params.quality, openAiStyle ? spec.qualities : [])
    : openAiImageQuality(request.params.quality)
  const mjSuffix = spec?.dialect === 'midjourney' ? mjFlags(request.params.mj) : ''
  const outbound: ImageRunRequest = mjSuffix
    ? { ...request, prompt: `${request.prompt} ${mjSuffix}`.trim() }
    : request
  const files = readFiles && openAiStyle ? await readImageFiles(core, request) : []
  return {
    request: outbound,
    spec,
    openAiStyle,
    count,
    size,
    specSize,
    quality,
    background,
    files,
  }
}
