import { isPublicHttpUrl } from '../shared/publicUrl'

/**
 * 画布浏览器地址栏的纯规则（2026-11-13 浏览器 UI 重做）。
 *
 * - 没写协议就补 `https://`（`dribbble.com/shots` → `https://dribbble.com/shots`）。
 * - **不做搜索兜底**：输入不像网址时如实报错，不偷偷拿去搜索引擎（用户口径）。
 * - 只放行公开的 http / https 地址：内网、localhost、`file:` 一律拒绝 —— 画布浏览器
 *   与 Agent 共用同一份登录目录，不能被拿去探内网。
 */
export type BrowserAddressResult =
  | { ok: true; url: string }
  | { ok: false; reason: 'empty' | 'invalid' | 'private' }

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i
const BARE_HOST = /^(?:[^\s/?#]+\.[^\s/?#.:]{2,}|\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?(?:[/?#]|$)/

export function normalizeBrowserAddress(raw: string): BrowserAddressResult {
  const value = raw.trim()
  if (!value) return { ok: false, reason: 'empty' }
  if (/\s/.test(value)) return { ok: false, reason: 'invalid' }
  let candidate = value
  if (!SCHEME.test(value)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^[^:]+:\d+/.test(value)) {
      return { ok: false, reason: 'invalid' }
    }
    if (!BARE_HOST.test(value)) return { ok: false, reason: 'invalid' }
    candidate = `https://${value}`
  }
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return { ok: false, reason: 'invalid' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'invalid' }
  }
  if (!isPublicHttpUrl(url.toString())) return { ok: false, reason: 'private' }
  return { ok: true, url: url.toString() }
}

export function browserAddressError(reason: 'empty' | 'invalid' | 'private'): string {
  if (reason === 'empty') return '请输入网址'
  if (reason === 'private') return '只能打开公开网页，内网和本机地址不支持'
  return '这不是有效的网址，例如 dribbble.com'
}

export interface BrowserAddressParts {
  /** 去掉 `www.` 的主机名，地址栏里加粗显示 */
  host: string
  /** 主机名之后的路径 + 查询，地址栏里弱化显示（根路径为空串） */
  rest: string
  secure: boolean
}

export function describeBrowserAddress(raw: string): BrowserAddressParts | null {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    const rest = `${url.pathname === '/' ? '' : url.pathname}${url.search}`
    return {
      host: url.host.replace(/^www\./i, ''),
      rest,
      secure: url.protocol === 'https:',
    }
  } catch {
    return null
  }
}
