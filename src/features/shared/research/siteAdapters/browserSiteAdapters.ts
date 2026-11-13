import { BROWSER_SITE_SPECS, type BrowserSiteSpec } from './browserSites'
import { runBrowserSite } from './browserSiteRun'
import type { BrowserSiteAdapter } from './types'

/**
 * 只能在真实浏览器里抓的设计站（对账 #1076 2026-11-13 实测：应用 HTTP 客户端（reqwest / curl）被挡，
 * 真实 Chrome 走同一代理可以打开）。桌面壳经 **Agent 后台浏览器**（隐藏 WebviewWindow，#1087）
 * 打开站内搜索页并提取图片；网页版没有那个端口，调度层只记 `needs-browser`，
 * **不发请求、不报错、不拿 Bing 结果冒充**。
 *
 * Behance 不在这里：真实浏览器也 403→400，开发者页已下线，只能暂缺。
 */
const REASONS: Record<BrowserSiteSpec['id'], string> = {
  dribbble: 'AWS WAF 挡非浏览器请求（HTTP 202 挑战页）',
  thedieline: '直连时有时被挡；无头浏览器会遇到「Checking your browser」验证页',
  packagingoftheworld: 'Sucuri WAF 对非浏览器请求回 307 挑战页；缩略图是 CSS 背景图',
  pinterest: '搜索结果由页面脚本渲染，未登录只显示少量被遮挡的结果并弹登录框',
}

function adapterOf(spec: BrowserSiteSpec): BrowserSiteAdapter {
  return {
    kind: 'browser',
    id: spec.id,
    label: spec.label,
    domain: spec.domain,
    reason: REASONS[spec.id],
    // 四站都是英文站：先用模型给的英文角度（live-run：POTW 中文词 0 条）
    queryLanguage: 'en',
    search: (context, request, signal) => runBrowserSite(spec, context, request, signal),
  }
}

/**
 * 顺序即直连站之后的图片排序。The Dieline 的模板仍保留（画布浏览器 / 以后要用浏览器抓时可用），
 * 但默认不再走浏览器：2026-11-14 起改为 WordPress REST 直连（`wordpressAdapter.ts`），不会撞 hashcash 验证。
 */
export const BROWSER_SITE_ADAPTERS: readonly BrowserSiteAdapter[] = BROWSER_SITE_SPECS
  .filter((spec) => spec.id !== 'thedieline')
  .map(adapterOf)
