import { fingerprintBytes } from '../../../domain/shared/hash'
import {
  authHeader,
  IMAGE_ASSET_DOWNLOAD_TIMEOUT_MS,
} from '../openaiCommon'
import { ChannelError, type GeneratedAsset, type ImageRunRequest } from '../types'
import type { AssetWriter, OpenAiImagesCore } from './contracts'
import {
  acceptedAfterSubmit,
  readNetworkDetail,
  submitNetwork,
} from './errorNormalization'
import { findGeminiImage, geminiNoImageReason } from './responseParsing'
import {
  geminiNativeRequestShape,
  toInlineImages,
} from './requestConstruction'
import type { ImageParamSpec } from '../../../domain/canvas/layout/imageParams'
import { classifyError } from '../openaiCommon'

export function unsupportedGeminiNativePath(
  detail: string,
  status: number,
): boolean {
  return (
    status === 404 ||
    (status === 503 &&
      /unsupported|not\s+support|不支持.*(?:API|接口|路径)|api\s+path/i.test(detail))
  )
}

export async function generateGeminiNativeImage(
  core: OpenAiImagesCore,
  assets: AssetWriter,
  request: ImageRunRequest,
  spec: ImageParamSpec,
  signal: AbortSignal,
): Promise<GeneratedAsset[] | null> {
  const inlineImages = await toInlineImages(core, request)
  const native = geminiNativeRequestShape(core, request, spec, inlineImages)
  const res = await submitNetwork('Gemini 生图提交', signal, () =>
    core.deps.network.request(
      {
        url: native.url,
        method: 'POST',
        headers: native.headers,
        body: native.body,
        timeoutMs: native.timeoutMs,
      },
      signal,
    ),
  )
  const detail = await readNetworkDetail(res)
  const unsupportedPath = unsupportedGeminiNativePath(detail, res.status)
  if (unsupportedPath) return null
  if (res.status < 200 || res.status >= 300) {
    if (res.status === 408 || res.status === 429 || res.status >= 500) {
      throw acceptedAfterSubmit(`Gemini 生图提交结果未知：HTTP ${res.status} ${detail}`)
    }
    const { error } = classifyError(null, res.status, detail)
    throw new ChannelError(error)
  }

  const responseBody = await res.json<unknown>()
  const image = findGeminiImage(responseBody)
  if (!image) {
    throw new ChannelError({
      kind: 'parse',
      raw: `Gemini 没有返回图片：${geminiNoImageReason(responseBody)}`,
    })
  }
  let bytes: Uint8Array
  let mimeType = image.mimeType
  if (image.kind === 'inline') {
    bytes = Uint8Array.from(atob(image.data), (character) => character.charCodeAt(0))
  } else {
    const download = await core.deps.network.request(
      {
        url: image.url,
        method: 'GET',
        headers: authHeader(core.config.apiKey),
        timeoutMs: IMAGE_ASSET_DOWNLOAD_TIMEOUT_MS,
      },
      signal,
    )
    if (download.status < 200 || download.status >= 300) {
      const downloadDetail = await download.text().catch(() => '')
      throw acceptedAfterSubmit(
        `Gemini 图片已生成，但下载失败：HTTP ${download.status} ${downloadDetail}`.trim(),
      )
    }
    bytes = new Uint8Array(await download.arrayBuffer())
    mimeType =
      download.headers['content-type']?.split(';')[0]?.trim() ||
      mimeType ||
      'image/png'
  }
  const hash = await fingerprintBytes(bytes)
  return [assets.toAsset(hash, mimeType || 'image/png', bytes, {})]
}
