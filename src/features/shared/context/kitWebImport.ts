import { isPublicHttpUrl } from '../../../domain/shared/publicUrl'
import type { NetworkPort } from '../../../platform/ports'
import { JINA_READER_ENDPOINT } from '../research/webPageReader'
import { extractKitPage, type KitPageExtract } from './kitWebPage'

/**
 * 套件「导入 URL」的网络部分（2026-11-12）：同一个输入框既收图片直链，也收品牌官网。
 *
 * - 目标先过 `isPublicHttpUrl`，再一律 `publicOnly: true`（桌面壳逐跳校验公网，内网 / localhost 不读）。
 * - 返回图片 → 直接作为参考素材；返回 HTML → 解析 Logo 候选、主题色与正文。
 * - 原网页直读失败（反爬、开发模式 publicOnly 失败关闭）时，走 Jina Reader 的 HTML 模式兜底，
 *   与 `readWebPage` 同一服务；本机只连 `r.jina.ai` 这个固定公网主机。
 * - 候选图片逐张下载并校验真的是图片、不超过 20MB，界面预览用本地 blob，不让 WebView 直连第三方站。
 */

export const KIT_URL_MAX_BYTES = 20 * 1024 * 1024
const HTML_MAX_BYTES = 4 * 1024 * 1024

const BROWSER_HEADERS: Readonly<Record<string, string>> = {
  Accept: 'text/html,application/xhtml+xml,image/*;q=0.9,*/*;q=0.5',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
}

export type KitUrlFetch =
  | { kind: 'image'; bytes: Uint8Array; mime: string; name: string }
  | { kind: 'page'; url: string; page: KitPageExtract; via: 'direct' | 'jina' }

function headerOf(headers: Record<string, string>, name: string): string {
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name)
  return key ? headers[key] ?? '' : ''
}

function nameFromUrl(url: string, fallback: string): string {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop()
    return last ? decodeURIComponent(last) : fallback
  } catch {
    return fallback
  }
}

function sniffImageMime(bytes: Uint8Array): string {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif'
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57 && bytes[9] === 0x45) return 'image/webp'
  return ''
}

/** 下载一张公网图片；不是图片、超过 20MB、非 2xx 都抛出可读的中文原因。 */
export async function downloadKitImage(
  network: NetworkPort,
  url: string,
  signal: AbortSignal,
): Promise<{ bytes: Uint8Array; mime: string; name: string }> {
  if (!isPublicHttpUrl(url)) throw new Error('只能导入公开互联网上的 http / https 地址')
  const response = await network.request(
    {
      url,
      method: 'GET',
      headers: { Accept: 'image/*,*/*;q=0.5' },
      publicOnly: true,
      timeoutMs: 30_000,
      maxResponseBytes: KIT_URL_MAX_BYTES,
    },
    signal,
  )
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`图片地址返回 HTTP ${response.status}`)
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.length === 0) throw new Error('图片地址没有内容')
  if (bytes.length > KIT_URL_MAX_BYTES) throw new Error('图片超过 20MB')
  const declared = headerOf(response.headers, 'content-type').split(';')[0]?.trim().toLowerCase() ?? ''
  const mime = declared.startsWith('image/') ? declared : sniffImageMime(bytes)
  if (!mime) throw new Error('这个地址返回的不是图片')
  return { bytes, mime, name: nameFromUrl(response.finalUrl ?? url, '网页图片') }
}

async function viaJinaHtml(
  network: NetworkPort,
  url: string,
  signal: AbortSignal,
): Promise<string> {
  const response = await network.request(
    {
      url: `${JINA_READER_ENDPOINT}${url}`,
      method: 'GET',
      headers: { Accept: 'text/html', 'X-Return-Format': 'html' },
      timeoutMs: 45_000,
      maxResponseBytes: HTML_MAX_BYTES,
    },
    signal,
  )
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`读取服务返回 HTTP ${response.status}`)
  }
  return response.text()
}

/** 读一个用户给的网址：图片直链返回字节，网页返回解析结果。 */
export async function fetchKitUrl(
  network: NetworkPort,
  rawUrl: string,
  signal: AbortSignal,
): Promise<KitUrlFetch> {
  const url = rawUrl.trim()
  if (!isPublicHttpUrl(url)) throw new Error('请输入公开互联网上的完整 http / https 地址')
  let directError = ''
  try {
    const response = await network.request(
      {
        url,
        method: 'GET',
        headers: { ...BROWSER_HEADERS },
        publicOnly: true,
        timeoutMs: 30_000,
        maxResponseBytes: KIT_URL_MAX_BYTES,
      },
      signal,
    )
    if (response.status >= 200 && response.status < 300) {
      const type = headerOf(response.headers, 'content-type').split(';')[0]?.trim().toLowerCase() ?? ''
      const finalUrl = response.finalUrl ?? url
      if (type.startsWith('image/')) {
        const bytes = new Uint8Array(await response.arrayBuffer())
        if (bytes.length === 0) throw new Error('图片地址没有内容')
        return { kind: 'image', bytes, mime: type, name: nameFromUrl(finalUrl, '网页图片') }
      }
      if (!type || /html|xml/.test(type)) {
        const html = await response.text()
        return { kind: 'page', url: finalUrl, page: extractKitPage(html, finalUrl), via: 'direct' }
      }
      throw new Error(`这个地址既不是图片也不是网页（${type}）`)
    }
    directError = `原网页返回 HTTP ${response.status}`
  } catch (error) {
    if (signal.aborted) throw error
    if (error instanceof Error && /既不是图片也不是网页|没有内容/.test(error.message)) throw error
    directError = '直接读取原网页失败'
  }
  try {
    const html = await viaJinaHtml(network, url, signal)
    return { kind: 'page', url, page: extractKitPage(html, url), via: 'jina' }
  } catch (error) {
    if (signal.aborted) throw error
    const reason = error instanceof Error ? error.message : '读取服务不可用'
    throw new Error(`${directError}；Jina Reader 兜底也失败：${reason}`)
  }
}
