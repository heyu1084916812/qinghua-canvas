import { describe, expect, it } from 'vitest'
import { parseHTML } from 'linkedom'
import { BROWSER_SITE_SPECS, browserSiteItems, browserSiteSpec, type BrowserSiteSpec } from './browserSites'
import { isPageSnapshot, pageExtractScript, parsePageSnapshot, type PageSnapshot } from './pageSnapshot'
import { classifyPageWall } from './pageWall'
import dribbbleHtml from './fixtures/dribbble-search.html?raw'
import dieline from './fixtures/dieline-search.html?raw'
import potw from './fixtures/potw-search.html?raw'
import pinterestGuest from './fixtures/pinterest-search-guest.html?raw'
import pinterestSignedIn from './fixtures/pinterest-search-signed-in.html?raw'
import dribbbleWaf from './fixtures/dribbble-waf-challenge.html?raw'
import potwSucuri from './fixtures/potw-sucuri-challenge.html?raw'
import dielineHashcash from './fixtures/dieline-hashcash-challenge.html?raw'

/**
 * 跑**真正注入页面的那段脚本字符串**（`pageExtractScript` 产出），文档由 linkedom 解析 fixture。
 * 这样测到的是：脚本自包含（toString 后能独立执行）+ 选择器 + 站点过滤 + 墙识别整条链。
 */
function runScript(html: string, spec: BrowserSiteSpec, href: string): PageSnapshot {
  const { document } = parseHTML(html)
  const script = pageExtractScript(spec.extract)
  const text = new Function('document', 'location', `return ${script}`)(document, { href }) as string
  const parsed = parsePageSnapshot(text)
  if (!isPageSnapshot(parsed)) throw new Error(`快照无效：${text.slice(0, 200)}`)
  return parsed
}

function spec(id: BrowserSiteSpec['id']): BrowserSiteSpec {
  const found = browserSiteSpec(id)
  if (!found) throw new Error(id)
  return found
}

function itemsOf(id: BrowserSiteSpec['id'], html: string, query = 'tea packaging') {
  const site = spec(id)
  const searchUrl = site.searchUrl(query)
  const snapshot = runScript(html, site, searchUrl)
  const items = browserSiteItems(site, snapshot, { queryIndex: 0, searchUrl, limit: 40 })
  const wall = classifyPageWall(snapshot, {
    requestedUrl: searchUrl,
    itemCount: items.length,
    ...(site.gatedMeansLogin ? { gatedMeansLogin: true } : {}),
  })
  return { site, searchUrl, snapshot, items, wall }
}

describe('浏览器专用设计站：搜索地址模板', () => {
  it('四个站的顺序与地址', () => {
    expect(BROWSER_SITE_SPECS.map((row) => row.id)).toEqual(['dribbble', 'thedieline', 'packagingoftheworld', 'pinterest'])
    expect(spec('dribbble').searchUrl(' tea  packaging ')).toBe('https://dribbble.com/search/tea-packaging')
    expect(spec('dribbble').searchUrl('茶 包装')).toBe('https://dribbble.com/search/%E8%8C%B6-%E5%8C%85%E8%A3%85')
    expect(spec('thedieline').searchUrl('tea box')).toBe('https://thedieline.com/?s=tea%20box')
    expect(spec('packagingoftheworld').searchUrl('tea')).toBe('https://packagingoftheworld.com/?s=tea')
    expect(spec('pinterest').searchUrl('tea packaging')).toBe('https://www.pinterest.com/search/pins/?q=tea%20packaging')
  })
})

describe('提取脚本 + 站点解析（2026-11-13 实录 fixture）', () => {
  it('Dribbble：图与原帖链接是兄弟节点，靠卡片配对；取 srcset 里 ≥800w 的一张；头像被挡掉', () => {
    const { items, wall } = itemsOf('dribbble', dribbbleHtml)
    expect(wall.kind).toBe('none')
    expect(items).toHaveLength(6)
    expect(items[0]).toMatchObject({
      source: 'dribbble',
      title: 'Relic Teas - Packaging design',
      url: 'https://dribbble.com/shots/23225723-Relic-Teas-Packaging-design',
    })
    expect(items[0]!.imageUrl).toMatch(/^https:\/\/cdn\.dribbble\.com\/userupload\/11873122\/.*resize=800x600/)
    expect(items[0]!.imageUrls?.[0]).toMatch(/resize=400x300/)
    for (const item of items) {
      expect(item.url).toMatch(/^https:\/\/dribbble\.com\/shots\/\d+/)
      expect(item.imageUrl).toMatch(/cdn\.dribbble\.com\/userupload\//)
      expect(item.id).toMatch(/^dribbble:0:/)
    }
    expect(new Set(items.map((item) => item.id)).size).toBe(6)
  })

  it('The Dieline：WordPress 卡片，标题与文章链接来自卡片', () => {
    const { items, wall } = itemsOf('thedieline', dieline, 'tea')
    expect(wall.kind).toBe('none')
    expect(items).toHaveLength(6)
    expect(items[1]).toMatchObject({
      source: 'thedieline',
      title: 'Turner Duckworth UK Gives Yorkshire Tea a ‘Proper’ Brand Refresh',
      url: 'https://thedieline.com/turner-duckworth-gives-yorkshire-tea-a-proper-brand-refresh/',
    })
    // srcset 里取 ≥1000w 的最小一张（1024w），不拉 2560 原图
    expect(items[1]!.imageUrl).toContain('YORKSHIRE_TEA_REBRAND_09-scaled.jpg?resize=1024%2C576')
    expect(items[1]!.description).toBe('The Dieline · 2560×1440')
  })

  it('Packaging of the World：缩略图是 CSS 背景图（data-bg），链接取 h5 标题', () => {
    const { items, wall } = itemsOf('packagingoftheworld', potw, 'tea')
    expect(wall.kind).toBe('none')
    expect(items.length).toBe(6)
    expect(items[0]).toMatchObject({
      source: 'packagingoftheworld',
      title: 'LabLeaf —natural cold-brewed tea',
      url: 'https://packagingoftheworld.com/2026/11/lableaf-natural-cold-brewed-tea.html',
    })
    expect(items[0]!.imageUrl).toMatch(/^https:\/\/i0\.wp\.com\/packagingoftheworld\.com\/wp-content\/uploads\/2026\/11\//)
    // 作者头像（gravatar）不算
    expect(items.every((item) => !item.imageUrl.includes('gravatar'))).toBe(true)
  })

  it('Pinterest 未登录：结果被门挡住 + 登录框 ⇒ 登录墙，挡住的几张仍可作部分结果（链接退回搜索页）', () => {
    const { items, wall, snapshot, searchUrl } = itemsOf('pinterest', pinterestGuest)
    expect(snapshot.signals.passwordField).toBe(true)
    expect(snapshot.signals.gatedCount).toBeGreaterThan(0)
    expect(wall.kind).toBe('login')
    expect(items.length).toBe(6)
    // 3x = 736x；未登录 DOM 没有 /pin/ 链接
    expect(items[0]!.imageUrl).toBe('https://i.pinimg.com/736x/bf/7d/29/bf7d297ebc98e024f9fe732e8e5dde6c.jpg')
    expect(items.every((item) => item.url === searchUrl)).toBe(true)
    expect(items[0]!.title).toBe('Pinterest 作品')
  })

  it('Pinterest 已登录（手写 fixture）：拿到 /pin/ 链接与描述，广告与头像被过滤，不算墙', () => {
    const { items, wall } = itemsOf('pinterest', pinterestSignedIn)
    expect(wall.kind).toBe('none')
    expect(items.map((item) => item.url)).toEqual([
      'https://www.pinterest.com/pin/1046664288921034563/',
      'https://www.pinterest.com/pin/4925880841296512/',
      'https://www.pinterest.com/pin/3378537950712045/',
    ])
    expect(items[0]!.title).toBe('Minimal tea packaging, kraft box with botanical label')
    expect(items[2]!.title).toBe('Pinterest 作品')
  })
})

describe('验证页识别（真实挑战页 fixture）', () => {
  it.each([
    ['dribbble', dribbbleWaf, 'aws-waf'],
    ['packagingoftheworld', potwSucuri, 'sucuri'],
    ['thedieline', dielineHashcash, 'hashcash'],
  ] as const)('%s 挑战页 ⇒ challenge', (id, html, marker) => {
    const { items, wall, snapshot } = itemsOf(id, html)
    expect(items).toHaveLength(0)
    expect(snapshot.signals.challengeMarkers).toContain(marker)
    expect(wall.kind).toBe('challenge')
  })
})

describe('parsePageSnapshot：页面结果不可信', () => {
  it('结构不对返回 null，脚本内部出错返回 error，非 http 图址丢弃', () => {
    expect(parsePageSnapshot('not json')).toBeNull()
    expect(parsePageSnapshot('{"title":"x"}')).toBeNull()
    expect(parsePageSnapshot('{"error":"boom"}')).toEqual({ error: 'boom' })
    const parsed = parsePageSnapshot(JSON.stringify({
      url: 'https://a.com/',
      title: 't',
      images: [
        { src: 'javascript:alert(1)', width: 1, height: 1 },
        { src: 'https://a.com/x.jpg', width: 300, height: -1, link: 'file:///c', alt: 'a' },
      ],
      signals: { passwordField: 'yes', challengeMarkers: ['x', 1], gatedCount: 2 },
    }))
    expect(isPageSnapshot(parsed)).toBe(true)
    if (!isPageSnapshot(parsed)) return
    expect(parsed.images).toEqual([{ src: 'https://a.com/x.jpg', width: 300, height: 0, alt: 'a', link: '', title: '' }])
    expect(parsed.signals).toEqual({ passwordField: false, challengeMarkers: ['x'], gatedCount: 2, textLength: 0 })
  })

  it('脚本在缺 DOM 能力时也不抛（出错时返回 error JSON）', () => {
    const script = pageExtractScript({})
    const text = new Function('document', 'location', `return ${script}`)(null, { href: 'https://a.com/' }) as string
    expect(JSON.parse(text)).toHaveProperty('error')
  })
})
