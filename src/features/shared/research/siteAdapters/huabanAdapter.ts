import type { DesignResearchItem } from '../../../../domain/inspiration/designResearch'
import { isPublicHttpUrl } from '../../../../domain/shared/publicUrl'
import { fetchSiteText, plainTitle, siteFailureText, siteFetchFailureOf } from './siteFetch'
import type { DirectSiteAdapter, SiteAdapterOutcome } from './types'

/**
 * 花瓣：`GET https://huaban.com/v3/search/pins?q=<词>&per_page=<n>` 返回 JSON（免登录、免 Key）。
 *
 * 图址口径（2026-11-13 实测）：
 * - `file.url` 是 `gd-hbimg-edge.huaban.com/<key>?auth_key=<过期时间戳>-…` 签名地址，**约一天内过期**，
 *   且边缘节点对非浏览器环境 / 外站 Referer 回 567 拦截页；只作最后备用。
 * - `gd-hbimg.huaban.com/<key>_fw658webp` 不需要签名，无 Referer 或花瓣 Referer 均 200
 *   （外站 Referer 与 `curl/*` UA 会被拒）。画廊 `<img referrerPolicy="no-referrer">` 正好满足。
 * - 原图 `gd-hbimg.huaban.com/<key>` 同样免签名，作保存时的第一备用。
 */
export const HUABAN_SEARCH_ENDPOINT = 'https://huaban.com/v3/search/pins'
export const HUABAN_IMAGE_HOST = 'https://gd-hbimg.huaban.com'
const HUABAN_LABEL = '花瓣'
/** 花瓣单页上限，实测 per_page=40 可用。 */
const HUABAN_MAX_PER_PAGE = 40

export function huabanSearchUrl(query: string, perPage: number): string {
  const url = new URL(HUABAN_SEARCH_ENDPOINT)
  url.searchParams.set('q', query)
  url.searchParams.set('per_page', String(Math.max(1, Math.min(HUABAN_MAX_PER_PAGE, Math.floor(perPage)))))
  return url.toString()
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function numberOf(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** 花瓣文件 key 只含字母数字与 `-_`；其它一律不拼地址。 */
const HUABAN_KEY = /^[A-Za-z0-9_-]{8,128}$/

export interface HuabanParseResult {
  /** 响应里根本没有 `pins` 数组（拦截页 / 改版）。 */
  recognized: boolean
  items: DesignResearchItem[]
}

/** 解析搜索接口 JSON → 调研候选（图片模式结构）。 */
export function parseHuabanSearch(payload: unknown, queryIndex = 0): HuabanParseResult {
  const pins = recordOf(payload).pins
  if (!Array.isArray(pins)) return { recognized: false, items: [] }
  const items: DesignResearchItem[] = []
  for (const raw of pins) {
    const pin = recordOf(raw)
    const pinId = numberOf(pin.pin_id) || Number(textOf(pin.pin_id)) || 0
    const file = recordOf(pin.file)
    const key = textOf(file.key)
    const type = textOf(file.type)
    if (!pinId || !HUABAN_KEY.test(key)) continue
    if (type && !type.startsWith('image/')) continue
    const signed = textOf(file.url)
    const imageUrl = `${HUABAN_IMAGE_HOST}/${key}_fw658webp`
    const fallbacks = [`${HUABAN_IMAGE_HOST}/${key}`, ...(isPublicHttpUrl(signed) ? [signed] : [])]
    const width = numberOf(file.width)
    const height = numberOf(file.height)
    const board = plainTitle(textOf(recordOf(pin.board).title))
    const title = plainTitle(textOf(pin.raw_text)) || board || '花瓣采集'
    const author = plainTitle(textOf(recordOf(pin.user).username))
    const size = width > 0 && height > 0 ? `${width}×${height}` : ''
    items.push({
      id: `huaban:${queryIndex}:${pinId}`,
      source: 'huaban',
      title,
      url: `https://huaban.com/pins/${pinId}`,
      imageUrl,
      imageUrls: fallbacks,
      description: [`花瓣采集${board ? ` · 画板「${board}」` : ''}`, size].filter(Boolean).join(' · '),
      ...(author ? { credit: author } : {}),
    })
  }
  return { recognized: true, items }
}

export const huabanAdapter: DirectSiteAdapter = {
  kind: 'direct',
  id: 'huaban',
  label: HUABAN_LABEL,
  domain: 'huaban.com',
  async search(network, request, signal): Promise<SiteAdapterOutcome> {
    const base = { id: 'huaban' as const, label: HUABAN_LABEL }
    let text: string
    try {
      text = await fetchSiteText(network, huabanSearchUrl(request.query, request.limit), 'application/json', signal)
    } catch (error) {
      const status = siteFetchFailureOf(error)
      return { ...base, status, items: [], failureText: siteFailureText(HUABAN_LABEL, status) }
    }
    let payload: unknown
    try {
      payload = JSON.parse(text)
    } catch {
      return { ...base, status: 'unrecognized', items: [], failureText: siteFailureText(HUABAN_LABEL, 'unrecognized') }
    }
    const parsed = parseHuabanSearch(payload, request.queryIndex)
    const items = parsed.items.slice(0, Math.max(0, request.limit))
    if (items.length > 0) return { ...base, status: 'ok', items }
    const status = parsed.recognized ? 'empty' : 'unrecognized'
    return { ...base, status, items: [], failureText: siteFailureText(HUABAN_LABEL, status) }
  },
}
