/**
 * 页面快照提取（对账 #1087，2026-11-13）：在 Agent 后台浏览器 / 画布浏览器的**原生 webview 里**
 * 执行的提取脚本，以及它返回结果的校验。
 *
 * - `extractPageSnapshot` 会被 `toString()` 成脚本注入页面执行，所以**必须自包含**：
 *   不引用模块里任何其它变量 / import，只用 DOM 标准 API；缺什么（如 `getBoundingClientRect`）
 *   都要先判断再用，测试里用 linkedom 跑同一个函数。
 * - 脚本**同步**返回 `JSON.stringify(...)`：WebView2 的 ExecuteScript 不会等 Promise。
 * - 只读 DOM，不点击、不填表、不发请求。
 */

export interface PageExtractOptions {
  /** 一条结果的卡片容器（图片与原帖链接常是兄弟节点，要靠卡片找链接）。 */
  cardSelector?: string
  /** 卡片里的原帖链接。 */
  linkSelector?: string
  /** 卡片里的标题。 */
  titleSelector?: string
  /** 用 CSS 背景图（`data-bg` / `style="background-image"`）显示缩略图的元素。 */
  backgroundSelector?: string
  /** 「被门挡住」的结果卡（如 Pinterest 未登录时的 gated pin）；只计数。 */
  gateSelector?: string
  /** 宽高任一边已知且小于它就丢掉（头像、图标）。 */
  minSize: number
  /** 最多返回多少张。 */
  maxImages: number
  /** srcset 里按宽度挑图：取 ≥ 它的最小一张，没有就取最大。 */
  preferWidth: number
  /** srcset 只有密度描述（1x/2x…）时取不超过它的最大一张。 */
  preferDensity: number
  /** 测试用：没有 `location` 时解析相对地址的基准。 */
  baseUrl?: string
}

export interface PageSnapshotImage {
  src: string
  /** 页面当前显示的那张（常是小图）；与 `src` 相同时省略。 */
  display?: string
  width: number
  height: number
  alt: string
  link: string
  title: string
}

export interface PageSnapshotSignals {
  /** 页面上有密码框（登录表单 / 登录弹层）。 */
  passwordField: boolean
  /** 命中的人机验证 / WAF 标记。 */
  challengeMarkers: string[]
  /** `gateSelector` 命中数。 */
  gatedCount: number
  /** 正文文字长度（判断空白挑战页）。 */
  textLength: number
}

export interface PageSnapshot {
  url: string
  title: string
  images: PageSnapshotImage[]
  signals: PageSnapshotSignals
}

export const DEFAULT_PAGE_EXTRACT_OPTIONS: PageExtractOptions = {
  minSize: 120,
  maxImages: 120,
  preferWidth: 1000,
  preferDensity: 3,
}

/**
 * 在页面里执行的提取函数（**自包含**，见文件头）。
 * 参数是 `Document` 与选项；返回可直接 `JSON.stringify` 的快照。
 */
export function extractPageSnapshot(doc: Document, opts: PageExtractOptions): PageSnapshot {
  const base = opts.baseUrl || doc.URL || ''
  const abs = (value: string | null | undefined): string => {
    const raw = (value || '').trim()
    if (!raw || /^(data|blob|javascript|about):/i.test(raw)) return ''
    try {
      const url = new URL(raw, base)
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : ''
    } catch {
      return ''
    }
  }
  const num = (value: unknown): number => {
    const n = typeof value === 'number' ? value : parseFloat(String(value || ''))
    return isFinite(n) && n > 0 ? Math.round(n) : 0
  }
  const clean = (value: string | null | undefined): string => (value || '').replace(/\s+/g, ' ').trim().slice(0, 300)
  /** srcset → 按宽度 / 密度挑一张；返回 [地址, 宽度描述] */
  const pickSrcset = (srcset: string): [string, number] => {
    const items: { url: string; w: number; x: number }[] = []
    for (const part of srcset.split(/,\s+(?=[^,\s]+(?:\s|$))/)) {
      const bits = part.trim().split(/\s+/)
      if (!bits[0]) continue
      const desc = bits[1] || '1x'
      const w = /w$/i.test(desc) ? num(desc.slice(0, -1)) : 0
      const x = /x$/i.test(desc) ? parseFloat(desc) || 1 : 0
      items.push({ url: bits[0], w, x })
    }
    if (items.length === 0) return ['', 0]
    const withWidth = items.filter((item) => item.w > 0).sort((a, b) => a.w - b.w)
    if (withWidth.length > 0) {
      const hit = withWidth.find((item) => item.w >= opts.preferWidth) || withWidth[withWidth.length - 1]!
      return [hit.url, hit.w]
    }
    const byDensity = items.slice().sort((a, b) => a.x - b.x)
    const fit = byDensity.filter((item) => item.x <= opts.preferDensity)
    const hit = fit.length > 0 ? fit[fit.length - 1]! : byDensity[0]!
    return [hit.url, 0]
  }
  const rectOf = (el: Element): [number, number] => {
    const node = el as Element & { getBoundingClientRect?: () => { width: number; height: number } }
    if (typeof node.getBoundingClientRect !== 'function') return [0, 0]
    try {
      const rect = node.getBoundingClientRect()
      return [num(rect.width), num(rect.height)]
    } catch {
      return [0, 0]
    }
  }
  const cardOf = (el: Element): Element | null => {
    if (!opts.cardSelector) return null
    try {
      return el.closest(opts.cardSelector)
    } catch {
      return null
    }
  }
  const linkOf = (el: Element, card: Element | null): string => {
    const own = el.closest('a[href]')
    if (card && opts.linkSelector) {
      let found: Element | null = null
      try {
        found = card.querySelector(opts.linkSelector)
      } catch {
        found = null
      }
      if (found) return abs(found.getAttribute('href'))
    }
    if (own) return abs(own.getAttribute('href'))
    if (card) {
      const any = card.querySelector('a[href]')
      if (any) return abs(any.getAttribute('href'))
    }
    return ''
  }
  const titleOf = (card: Element | null): string => {
    if (!card || !opts.titleSelector) return ''
    try {
      const node = card.querySelector(opts.titleSelector)
      return node ? clean(node.textContent) : ''
    } catch {
      return ''
    }
  }

  const images: PageSnapshotImage[] = []
  const seen: Record<string, true> = {}
  const push = (image: PageSnapshotImage) => {
    if (!image.src || seen[image.src] || images.length >= opts.maxImages) return
    const small = (image.width > 0 && image.width < opts.minSize) || (image.height > 0 && image.height < opts.minSize)
    if (small) return
    seen[image.src] = true
    images.push(image)
  }

  const imgs = doc.querySelectorAll('img')
  for (let i = 0; i < imgs.length; i += 1) {
    const img = imgs[i]!
    if (img.closest('noscript')) continue
    const srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset') || ''
    const [fromSet, setWidth] = srcset ? pickSrcset(srcset) : ['', 0]
    const display = abs(img.getAttribute('src')) || abs((img as HTMLImageElement).currentSrc)
    const lazy = abs(img.getAttribute('data-src')) || abs(img.getAttribute('data-lazy-src')) || abs(img.getAttribute('data-original'))
    const src = abs(fromSet) || lazy || display
    if (!src) continue
    const [rw, rh] = rectOf(img)
    const natural = img as HTMLImageElement
    const width = Math.max(num(natural.naturalWidth), num(img.getAttribute('width')), rw)
    const height = Math.max(num(natural.naturalHeight), num(img.getAttribute('height')), rh)
    const card = cardOf(img)
    push({
      src,
      ...(display && display !== src ? { display } : {}),
      width: width || setWidth,
      height,
      alt: clean(img.getAttribute('alt')),
      link: linkOf(img, card),
      title: titleOf(card),
    })
  }

  if (opts.backgroundSelector) {
    let nodes: ArrayLike<Element> = []
    try {
      nodes = doc.querySelectorAll(opts.backgroundSelector)
    } catch {
      nodes = []
    }
    for (let i = 0; i < nodes.length; i += 1) {
      const el = nodes[i]!
      const style = el.getAttribute('style') || ''
      const match = /background(?:-image)?\s*:[^;]*url\(\s*(['"]?)([^'")]+)\1\s*\)/i.exec(style.replace(/&quot;/g, '"'))
      const src = abs(el.getAttribute('data-bg')) || abs(el.getAttribute('data-background')) || abs(match ? match[2] : '')
      if (!src) continue
      const [rw, rh] = rectOf(el)
      const card = cardOf(el)
      push({
        src,
        width: rw,
        height: rh,
        alt: clean(el.getAttribute('aria-label') || el.getAttribute('title')),
        link: linkOf(el, card),
        title: titleOf(card),
      })
    }
  }

  const markers: string[] = []
  const checks: [string, string][] = [
    ['#challenge-form', 'cloudflare-form'],
    ['#challenge-running', 'cloudflare-running'],
    ['#cf-challenge-running', 'cloudflare-running'],
    ['[id^="cf-chl"]', 'cloudflare-chl'],
    ['script[src*="challenges.cloudflare.com"]', 'cloudflare-turnstile'],
    ['#challenge-container', 'aws-waf'],
    ['script[src*="awswaf"]', 'aws-waf'],
    ['script[src*="/__challenge/"]', 'hashcash'],
    ['iframe[src*="hcaptcha.com"]', 'hcaptcha'],
    ['iframe[src*="geetest"]', 'geetest'],
  ]
  for (const [selector, name] of checks) {
    try {
      if (doc.querySelector(selector) && markers.indexOf(name) < 0) markers.push(name)
    } catch {
      /* 选择器不支持就跳过 */
    }
  }
  const scripts = doc.querySelectorAll('script')
  for (let i = 0; i < scripts.length; i += 1) {
    if ((scripts[i]!.textContent || '').indexOf('sucuri_cloudproxy') >= 0) {
      markers.push('sucuri')
      break
    }
  }
  let gatedCount = 0
  if (opts.gateSelector) {
    try {
      gatedCount = doc.querySelectorAll(opts.gateSelector).length
    } catch {
      gatedCount = 0
    }
  }
  const body = doc.body
  return {
    url: base,
    title: clean(doc.title),
    images,
    signals: {
      passwordField: Boolean(doc.querySelector('input[type="password"]')),
      challengeMarkers: markers,
      gatedCount,
      textLength: body ? (body.textContent || '').replace(/\s+/g, ' ').trim().length : 0,
    },
  }
}

/**
 * 生成注入页面的脚本：同步执行 `extractPageSnapshot(document, options)` 并返回 JSON 字符串。
 * 页面里的 `location.href` 作为基准地址（选项里的 `baseUrl` 只给测试用）。
 */
export function pageExtractScript(options: Partial<PageExtractOptions> = {}): string {
  const merged: PageExtractOptions = { ...DEFAULT_PAGE_EXTRACT_OPTIONS, ...options }
  return `(function(){try{var o=${JSON.stringify(merged)};if(!o.baseUrl){o.baseUrl=String(location.href)}`
    + `return JSON.stringify((${extractPageSnapshot.toString()})(document,o))}`
    + `catch(e){return JSON.stringify({error:String(e&&e.message||e)})}})()`
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0
}

/** 校验脚本结果（来自页面，不可信）：结构不对返回 null；脚本内部出错返回 `{ error }`。 */
export function parsePageSnapshot(text: string): PageSnapshot | { error: string } | null {
  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    return null
  }
  const root = recordOf(payload)
  if (typeof root.error === 'string') return { error: root.error.slice(0, 200) }
  if (!Array.isArray(root.images)) return null
  const signals = recordOf(root.signals)
  const images: PageSnapshotImage[] = []
  for (const raw of root.images.slice(0, 300)) {
    const row = recordOf(raw)
    const src = str(row.src)
    if (!/^https?:\/\//i.test(src)) continue
    const display = str(row.display)
    images.push({
      src,
      ...(/^https?:\/\//i.test(display) ? { display } : {}),
      width: count(row.width),
      height: count(row.height),
      alt: str(row.alt).slice(0, 300),
      link: /^https?:\/\//i.test(str(row.link)) ? str(row.link) : '',
      title: str(row.title).slice(0, 300),
    })
  }
  return {
    url: str(root.url),
    title: str(root.title).slice(0, 300),
    images,
    signals: {
      passwordField: signals.passwordField === true,
      challengeMarkers: Array.isArray(signals.challengeMarkers)
        ? signals.challengeMarkers.filter((m): m is string => typeof m === 'string').slice(0, 20)
        : [],
      gatedCount: count(signals.gatedCount),
      textLength: count(signals.textLength),
    },
  }
}

export function isPageSnapshot(value: PageSnapshot | { error: string } | null): value is PageSnapshot {
  return Boolean(value) && !('error' in value!)
}
