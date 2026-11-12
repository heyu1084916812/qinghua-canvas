import type { NetworkPort } from '../../../platform/ports'
import { htmlToReadableText } from './htmlReadableText'

/**
 * Jina Reader 失败时的兜底：本机直接抓原网页并转成可读文字（2026-11-12）。
 *
 * 请求一律 `publicOnly: true`（只允许 GET，桌面壳逐跳校验公网、跟随系统代理）；
 * 浏览器开发模式没有桌面壳时 publicOnly 失败关闭，这里如实返回错误。
 * 只认 HTML / 纯文本响应；PDF、图片等直接报“不是网页”。登录墙判断留给调用方统一做。
 */
export interface DirectPageText {
  title: string
  content: string
  /** 跟随重定向后的地址。 */
  finalUrl: string
}

export type DirectPageOutcome =
  | { ok: true; page: DirectPageText }
  | { ok: false; error: unknown }

const DIRECT_HEADERS: Readonly<Record<string, string>> = {
  Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
}

function headerOf(headers: Record<string, string>, name: string): string {
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name)
  return key ? headers[key] ?? '' : ''
}

export async function readPageDirect(
  network: NetworkPort,
  url: string,
  signal: AbortSignal,
): Promise<DirectPageOutcome> {
  try {
    const response = await network.request(
      {
        url,
        method: 'GET',
        headers: { ...DIRECT_HEADERS },
        publicOnly: true,
        timeoutMs: 30_000,
        maxResponseBytes: 4 * 1024 * 1024,
      },
      signal,
    )
    if (response.status < 200 || response.status >= 300) {
      throw { kind: 'http', status: response.status }
    }
    const contentType = headerOf(response.headers, 'content-type').toLowerCase()
    const raw = await response.text()
    const finalUrl = response.finalUrl ?? url
    if (contentType && !/(html|xml|text\/)/.test(contentType)) {
      return { ok: false, error: { kind: 'unsupported', contentType: contentType.split(';')[0] } }
    }
    if (contentType.startsWith('text/plain')) {
      return { ok: true, page: { title: '', content: raw.trim(), finalUrl } }
    }
    const readable = htmlToReadableText(raw)
    return { ok: true, page: { title: readable.title, content: readable.text, finalUrl } }
  } catch (error) {
    return { ok: false, error }
  }
}
