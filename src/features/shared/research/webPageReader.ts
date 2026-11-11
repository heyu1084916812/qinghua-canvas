import type { NetworkPort } from '../../../platform/ports'
import { isPublicHttpUrl } from '../../../domain/shared/publicUrl'
import { asAppError } from '../../../shared/result'

/**
 * 读网页正文：默认走 Jina Reader（`GET https://r.jina.ai/<url>`，无需 Key）。
 *
 * - 目标地址先过 `isPublicHttpUrl`：内网 / localhost 一律不读；真正抓取由 Jina 服务端完成，
 *   本机只连 `r.jina.ai` 这个固定公网主机，因此不需要 publicOnly（Rust 的 publicOnly
 *   通道也只允许 GET；浏览器开发模式下 publicOnly 会直接失败关闭）。
 * - 正文截断到 `maxChars`（默认 8000），超出时标记 `truncated`。
 * - 登录墙 / 验证码 / 非 2xx 一律如实返回 `ok:false` 并给出两条退路。
 */
export const JINA_READER_ENDPOINT = 'https://r.jina.ai/'
export const DEFAULT_READ_PAGE_MAX_CHARS = 8000

export const READ_PAGE_FALLBACK_HINT =
  '可以改为搜索公开来源，或请用户把页面截图 / 关键文字直接贴进对话。'

export interface ReadWebPageResult {
  ok: boolean
  url: string
  title: string
  content: string
  truncated: boolean
  /** 正文原始长度（截断前）。 */
  totalChars: number
  error?: string
  hint?: string
}

/** 常见登录墙 / 人机验证 / 拦截页的特征；只在正文很短时才判定，避免误伤正常文章。 */
const BLOCKED_PATTERNS: readonly RegExp[] = [
  /captcha/i,
  /verify (that )?you are (a )?human/i,
  /are you a robot/i,
  /just a moment\.\.\./i,
  /access denied/i,
  /enable javascript and cookies/i,
  /please (log ?in|sign ?in)/i,
  /sign in to continue/i,
  /登录后(查看|继续|可见)/,
  /请(先)?登录/,
  /验证码/,
  /安全验证/,
  /人机验证/,
]

interface ParsedJina {
  title: string
  url: string
  /** 跟随重定向后的地址；被重定向到登录页是登录墙的强信号。 */
  finalUrl: string
  content: string
  warning: string
}

/** 解析 Jina 的纯文本格式：`Title:` / `URL Source:` / `Warning:` / `Markdown Content:`。 */
export function parseJinaReaderText(raw: string, fallbackUrl: string): ParsedJina {
  const text = raw.replace(/\r\n/g, '\n')
  const marker = /^Markdown Content:\s*$/m.exec(text)
  const head = marker ? text.slice(0, marker.index) : ''
  const body = marker ? text.slice(marker.index + marker[0].length) : text
  const field = (name: string) =>
    new RegExp(`^${name}:\\s*(.*)$`, 'm').exec(head)?.[1]?.trim() ?? ''
  return {
    title: field('Title'),
    url: field('URL Source') || fallbackUrl,
    finalUrl: field('Final URL'),
    content: body.replace(/\n{3,}/g, '\n\n').trim(),
    warning: [...head.matchAll(/^Warning:\s*(.*)$/gm)].map((m) => m[1]!.trim()).join('；'),
  }
}

function failure(url: string, error: string): ReadWebPageResult {
  return {
    ok: false,
    url,
    title: '',
    content: '',
    truncated: false,
    totalChars: 0,
    error,
    hint: READ_PAGE_FALLBACK_HINT,
  }
}

function describeReadError(error: unknown): string {
  const app = asAppError(error)
  if (app?.kind === 'http') {
    if (app.status === 401 || app.status === 403) {
      return `页面拒绝访问（HTTP ${app.status}），可能需要登录或被反爬拦截`
    }
    if (app.status === 404) return '页面不存在（HTTP 404）'
    if (app.status === 429) return '读取服务限流（HTTP 429），请稍后再试'
    return `页面读取失败（HTTP ${app.status}）`
  }
  if (app?.kind === 'network') {
    if (app.detail === 'aborted') return '读取已取消'
    if (app.detail === 'timeout') return '读取超时'
    return `网络错误（${app.detail}）`
  }
  return '页面读取失败'
}

export async function readWebPage(
  network: NetworkPort,
  url: string,
  signal: AbortSignal,
  options: { maxChars?: number } = {},
): Promise<ReadWebPageResult> {
  const target = url.trim()
  if (!isPublicHttpUrl(target)) {
    return failure(target, '只能读取公开互联网上的 http / https 页面')
  }
  const maxChars = Math.max(500, Math.min(20_000, options.maxChars ?? DEFAULT_READ_PAGE_MAX_CHARS))
  let raw: string
  try {
    const response = await network.request(
      {
        url: `${JINA_READER_ENDPOINT}${target}`,
        method: 'GET',
        headers: { Accept: 'text/plain' },
        timeoutMs: 45_000,
        maxResponseBytes: 4 * 1024 * 1024,
      },
      signal,
    )
    if (response.status < 200 || response.status >= 300) {
      throw { kind: 'http', status: response.status }
    }
    raw = await response.text()
  } catch (error) {
    return failure(target, describeReadError(error))
  }
  const parsed = parseJinaReaderText(raw, target)
  const statusWarning = /returned error (\d{3})/i.exec(parsed.warning)
  if (statusWarning) {
    return failure(
      parsed.url,
      `目标页面返回 HTTP ${statusWarning[1]}，可能需要登录、被反爬拦截或已失效`,
    )
  }
  // Jina 实测（2026-11-11 小红书）：登录墙会给 `Warning: This page maybe requiring CAPTCHA`、
  // 标题 `Log in - …`，并重定向到 `/login`。这三类信号任意命中即如实失败。
  if (
    /captcha/i.test(parsed.warning) ||
    /^(log ?in|sign ?in|登录|登入)\b/i.test(parsed.title) ||
    /\/(login|signin|passport)\b/i.test(parsed.finalUrl)
  ) {
    return failure(parsed.url, '页面要求登录或人机验证，读不到正文')
  }
  if (!parsed.content) {
    return failure(parsed.url, '页面没有可读取的正文（可能需要登录或由脚本动态渲染）')
  }
  if (
    parsed.content.length < 1500 &&
    BLOCKED_PATTERNS.some((pattern) => pattern.test(`${parsed.title}\n${parsed.content}`))
  ) {
    return failure(parsed.url, '页面要求登录或人机验证，读不到正文')
  }
  const truncated = parsed.content.length > maxChars
  return {
    ok: true,
    url: parsed.url,
    title: parsed.title || parsed.url,
    content: truncated ? `${parsed.content.slice(0, maxChars)}\n…（正文已截断）` : parsed.content,
    truncated,
    totalChars: parsed.content.length,
  }
}
