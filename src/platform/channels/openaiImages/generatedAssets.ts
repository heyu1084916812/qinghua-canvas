import { fingerprintBytes } from '../../../domain/shared/hash'
import { imageSizeFromHeader } from '../../../domain/shared/imageSize'
import { IMAGE_ASSET_DOWNLOAD_TIMEOUT_MS, authHeader } from '../openaiCommon'
import { ChannelError, type GeneratedAsset } from '../types'
import type {
  AssetWriter,
  ImageItem,
  OpenAiImagesCore,
} from './contracts'
import type { RequestedImageDimensions } from './imageParams'
import { acceptedAfterSubmit, transportTextOf } from './errorNormalization'
import { imageItemsIn } from './responseParsing'

export function toAsset(
  hash: string,
  mime: string,
  bytes: Uint8Array,
  requested: RequestedImageDimensions,
): GeneratedAsset {
  /**
   * 实际像素只能从产物字节头读；把请求 size 同时写成实际像素会让日志里
   * 「请求 = 实际」恒等，看起来已完成实则什么都没证明。
   */
  const actual = imageSizeFromHeader(bytes)
  return {
    hash,
    mime,
    bytes,
    ...(actual ? { width: actual.width, height: actual.height } : {}),
    ...(requested.width && requested.height
      ? { requestedWidth: requested.width, requestedHeight: requested.height }
      : {}),
  }
}

type AssetCore = Pick<OpenAiImagesCore, 'config' | 'deps' | 'base'>

export function createGeneratedAssetFactory(core: AssetCore): AssetWriter {
  const mediaHeaders = (url: string): Record<string, string> => {
    try {
      return new URL(url).origin === new URL(core.base).origin
        ? authHeader(core.config.apiKey)
        : {}
    } catch {
      return {}
    }
  }

  const assetsFromItems = async (
    items: readonly ImageItem[],
    requested: RequestedImageDimensions,
    signal: AbortSignal,
  ): Promise<GeneratedAsset[]> => {
    const assets: GeneratedAsset[] = []
    const failures: string[] = []
    for (const item of items) {
      const inlineB64 = item.b64_json ?? item.fallbackB64
      const candidates = [item.url, ...(item.fallbackUrls ?? [])].filter(
        (url): url is string => typeof url === 'string' && url.length > 0,
      )
      let bytes: Uint8Array | null = null
      let mime = 'image/png'
      /* 外部 CDN 绝不接收渠道 Key；同站产物才允许带鉴权头。 */
      for (const url of candidates) {
        try {
          const dataUri = /^data:([^;,]+);base64,(.*)$/is.exec(url)
          if (dataUri) {
            bytes = Uint8Array.from(atob(dataUri[2]!.replace(/\s+/g, '')), (c) => c.charCodeAt(0))
            mime = dataUri[1] ?? mime
            break
          }
          const response = await core.deps.network.request(
            {
              url,
              method: 'GET',
              headers: mediaHeaders(url),
              timeoutMs: IMAGE_ASSET_DOWNLOAD_TIMEOUT_MS,
            },
            signal,
          )
          bytes = new Uint8Array(await response.arrayBuffer())
          mime = response.headers['content-type']?.split(';')[0]?.trim() || mime
          break
        } catch (error) {
          if (signal.aborted) throw error
          failures.push(
            `${/^data:image\//i.test(url) ? 'data URI' : url.slice(0, 180)}：${transportTextOf(error)}`,
          )
        }
      }
      if (!bytes && inlineB64) {
        bytes = Uint8Array.from(atob(inlineB64.replace(/\s+/g, '')), (c) => c.charCodeAt(0))
        mime = 'image/png'
      }
      if (bytes) {
        const hash = await fingerprintBytes(bytes)
        assets.push(toAsset(hash, mime, bytes, requested))
      }
    }
    if (assets.length === 0 && failures.length > 0) {
      throw acceptedAfterSubmit(
        `图片已生成，但产物下载失败：${failures.slice(0, 3).join('；')}`,
      )
    }
    return assets
  }

  const toAssets = async (
    res: Awaited<ReturnType<OpenAiImagesCore['deps']['network']['request']>>,
    requested: RequestedImageDimensions,
    signal: AbortSignal,
  ): Promise<GeneratedAsset[]> => {
    const body = await res.json<unknown>()
    const items = imageItemsIn(body)
    if (items.length === 0) {
      throw new ChannelError({
        kind: 'parse',
        raw: `图片接口返回的不是图片列表：${JSON.stringify(body).slice(0, 2000)}`,
      })
    }
    return assetsFromItems(items, requested, signal)
  }

  return { toAsset, assetsFromItems, toAssets }
}
