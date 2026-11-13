import { imageMimeFromBytes } from '../../../../domain/shared/imageMime'
import type { PlatformKit } from '../../../../platform/ports'

const EXTENSION_OF: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif',
}

/**
 * 调研图片「下载」（2026-11-14 live run）：先走与「加入参考」同一条公开网络通道
 * （桌面 = Rust reqwest，无 Referer、不受 CORS 限制），拿到真图片字节就按实际格式落盘；
 * 通道不可用（纯浏览器失败关闭）或拿到的不是图片，返回 null 让调用方退回 `saveFromUrl`。
 * 原先直接 `saveFromUrl` ⇒ WebView `fetch` 被 CORS 拦，BP&O / Lovely Package（不给
 * Access-Control-Allow-Origin）只能交给系统浏览器打开，存不下来。
 */
export async function downloadResearchImageBytes(
  platform: Pick<PlatformKit, 'network' | 'files'>,
  imageUrl: string,
  baseName: string,
  signal: AbortSignal,
): Promise<'saved' | null> {
  let bytes: Uint8Array
  try {
    const res = await platform.network.request({
      url: imageUrl, method: 'GET', publicOnly: true, timeoutMs: 30_000, maxResponseBytes: 32 * 1024 * 1024,
    }, signal)
    if (res.status < 200 || res.status >= 300) return null
    bytes = new Uint8Array(await res.arrayBuffer())
  } catch (error) {
    if (signal.aborted) throw signal.reason ?? error
    return null
  }
  const mime = bytes.length > 0 ? imageMimeFromBytes(bytes) : null
  if (!mime) return null
  if (signal.aborted) throw signal.reason ?? new DOMException('已取消', 'AbortError')
  const name = `${baseName}.${EXTENSION_OF[mime] ?? 'jpg'}`
  await platform.files.saveFile(name, new Blob([bytes as BlobPart], { type: mime }))
  return 'saved'
}
