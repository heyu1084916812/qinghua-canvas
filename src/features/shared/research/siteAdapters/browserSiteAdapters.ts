import type { BrowserSiteAdapter } from './types'

/**
 * 只能在真实浏览器里抓的设计站（对账 #1076 2026-11-13 实测）：应用 HTTP 客户端（reqwest / curl）被挡，
 * 真实 Chrome 走同一代理可以打开。以后经隐藏 webview 实现 `search`；在那之前调度层只记
 * `needs-browser`，**不发请求、不报错、不拿 Bing 结果冒充**。
 *
 * Behance 不在这里：真实浏览器也 403→400，开发者页已下线，只能暂缺。
 */
export const BROWSER_SITE_ADAPTERS: readonly BrowserSiteAdapter[] = [
  {
    kind: 'browser',
    id: 'dribbble',
    label: 'Dribbble',
    domain: 'dribbble.com',
    reason: 'Cloudflare 挡非浏览器请求（HTTP 202 空页）',
  },
  {
    kind: 'browser',
    id: 'thedieline',
    label: 'The Dieline',
    domain: 'thedieline.com',
    reason: '无代理直连 403；本机经系统代理时 HTTP 可通，但结果页解析未接入，先按浏览器适配器排期',
  },
  {
    kind: 'browser',
    id: 'packagingoftheworld',
    label: 'Packaging of the World',
    domain: 'packagingoftheworld.com',
    reason: 'Sucuri WAF 对非浏览器请求回 307 挑战页',
  },
  {
    kind: 'browser',
    id: 'pinterest',
    label: 'Pinterest',
    domain: 'pinterest.com',
    reason: '搜索结果在页面脚本里、内部接口 403，需要登录态',
  },
]
