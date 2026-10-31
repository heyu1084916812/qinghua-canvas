import type { DesignResearchItem } from '../../../domain/inspiration/designResearch'
import {
  DESIGN_RESEARCH_MAX_IMAGE_PIXELS,
  DESIGN_RESEARCH_RIGHTS_NOTE,
} from '../../../domain/inspiration/designResearch'
import { fingerprintBytes } from '../../../domain/shared/hash'
import { imageMimeFromBytes } from '../../../domain/shared/imageMime'
import { imageSizeFromHeader } from '../../../domain/shared/imageSize'
import { isPublicHttpUrl } from '../../../domain/shared/publicUrl'
import type { NetworkPort, StoragePort } from '../../../platform/ports'
import { errorTextOf } from '../../../shared/result'
import {
  ASSET_LIBRARY_TAGS_KEY,
  createAssetLibraryRepository,
} from '../../../state/project/assetLibraryRepository'

function sourceTag(source: DesignResearchItem['source']): string {
  if (source === 'pinterest') return 'Pinterest'
  if (source === 'behance') return 'Behance'
  if (source === 'google') return 'Google'
  return '网页'
}

function sourceHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase()
  } catch {
    return ''
  }
}

export async function saveDesignResearchItem(
  item: DesignResearchItem,
  deps: {
    network: NetworkPort
    storage: StoragePort
  },
  signal: AbortSignal,
): Promise<{ ok: boolean; message: string }> {
  if (!item.imageUrl) return { ok: false, message: '这张参考没有可保存的图片地址' }
  if (!isPublicHttpUrl(item.imageUrl) || !isPublicHttpUrl(item.url)) {
    return { ok: false, message: '来源不是公开互联网地址，已拒绝保存' }
  }
  try {
    const response = await deps.network.request(
      {
        url: item.imageUrl,
        method: 'GET',
        publicOnly: true,
        maxResponseBytes: 32 * 1024 * 1024,
        timeoutMs: 30_000,
      },
      signal,
    )
    if (response.status < 200 || response.status >= 300) {
      return { ok: false, message: `图片读取失败：HTTP ${response.status}` }
    }
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (signal.aborted) return { ok: false, message: '保存已取消' }
    if (bytes.length === 0) return { ok: false, message: '图片字节为空' }
    const hash = await fingerprintBytes(bytes)
    const contentTypeHeader = Object.entries(response.headers).find(
      ([name]) => name.toLowerCase() === 'content-type',
    )?.[1]
    const declaredMime = (contentTypeHeader ?? '').split(';')[0]!.trim().toLowerCase()
    const detectedMime = imageMimeFromBytes(bytes)
    if (!detectedMime) {
      return { ok: false, message: '来源返回的不是图片' }
    }
    if (
      declaredMime.startsWith('image/') &&
      declaredMime !== detectedMime &&
      !(
        declaredMime === 'image/jpg' &&
        detectedMime === 'image/jpeg'
      )
    ) {
      return { ok: false, message: '图片响应头与实际文件格式不一致' }
    }
    const size = imageSizeFromHeader(bytes)
    if (!size) {
      return { ok: false, message: '无法读取图片尺寸，文件可能已损坏' }
    }
    if (size.width * size.height > DESIGN_RESEARCH_MAX_IMAGE_PIXELS) {
      return { ok: false, message: '图片超过 2000 万像素，已拒绝保存' }
    }
    const savedAt = Date.now()
    const host = sourceHost(item.url)
    if (signal.aborted) return { ok: false, message: '保存已取消' }
    await deps.storage.transaction(['assets', 'assetLibrary', 'presets'], async (tx) => {
      if (signal.aborted) throw new DOMException('保存已取消', 'AbortError')
      await tx.put('assets', {
        id: hash,
        hash,
        mime: detectedMime,
        bytes,
        createdAt: savedAt,
        projectId: 'inspiration-library',
        width: size.width,
        height: size.height,
      } as never)
      if (signal.aborted) throw new DOMException('保存已取消', 'AbortError')
      const library = createAssetLibraryRepository(tx)
      await library.save({
        hash,
        mime: detectedMime,
        bytes: bytes.length,
        width: size.width,
        height: size.height,
        savedAt,
        projectId: 'inspiration-library',
        prompt: `${item.title}\n来源：${item.url}\n${DESIGN_RESEARCH_RIGHTS_NOTE}`,
      })
      if (signal.aborted) throw new DOMException('保存已取消', 'AbortError')
      await library.setTags(
        hash,
        ['设计调研', sourceTag(item.source), ...(host ? [host] : [])],
      )
      if (signal.aborted) throw new DOMException('保存已取消', 'AbortError')
      const assetRows = await tx.query('assets', { id: hash })
      const libraryRows = await tx.query('assetLibrary', { id: hash })
      if (assetRows.length !== 1 || libraryRows.length !== 1) {
        throw new Error('素材写入后回读失败')
      }
      const storedAsset = assetRows[0] as {
        bytes?: unknown
        hash?: unknown
        mime?: unknown
      }
      const storedBytes =
        storedAsset.bytes instanceof Uint8Array
          ? storedAsset.bytes
          : storedAsset.bytes instanceof ArrayBuffer
            ? new Uint8Array(storedAsset.bytes)
            : null
      if (
        storedAsset.hash !== hash ||
        storedAsset.mime !== detectedMime ||
        !storedBytes ||
        storedBytes.length !== bytes.length ||
        (await fingerprintBytes(storedBytes)) !== hash
      ) {
        throw new Error('素材字节回读校验失败')
      }
      const libraryRow = libraryRows[0] as { mime?: unknown; bytes?: unknown }
      if (libraryRow.mime !== detectedMime || libraryRow.bytes !== bytes.length) {
        throw new Error('素材库记录回读校验失败')
      }
      const tagRows = await tx.query('presets', { id: ASSET_LIBRARY_TAGS_KEY })
      const tagMap = (tagRows[0]?.tags ?? {}) as Record<string, unknown>
      const storedTags = Array.isArray(tagMap[hash]) ? tagMap[hash] as string[] : []
      if (!storedTags.includes('设计调研') || !storedTags.includes(sourceTag(item.source))) {
        throw new Error('素材标签回读校验失败')
      }
      if (signal.aborted) throw new DOMException('保存已取消', 'AbortError')
    })
    return { ok: true, message: '已保存到素材库' }
  } catch (cause) {
    return {
      ok: false,
      message: errorTextOf(cause),
    }
  }
}
