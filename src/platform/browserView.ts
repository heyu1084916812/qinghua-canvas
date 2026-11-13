/**
 * 原生网页视图端口（2026-11-13，画布浏览器换原生 webview）。
 *
 * 为什么要有它：iframe 版画布浏览器被 X-Frame-Options / CSP 挡掉一大半设计站，
 * 跨域也读不到 DOM，Agent 用不上。桌面壳改成 Tauri 2 子 webview（Windows = WebView2，
 * macOS = WKWebView），所有视图共用一份**独立的浏览器数据目录**（app 数据目录下
 * `browser-profile`），用户在里面登录一次，重启后仍在，Agent 之后也能复用同一份登录。
 *
 * 形态约定：
 * - 一个视图用 `id` 标识（只允许 `[a-z0-9-]`），画布浏览器用 `canvas`；下一步 Agent 的
 *   隐藏视图用别的 id（如 `agent`），**同一端口、同一 profile**，不再另起一套。
 * - `bounds` 是主窗口内容区里的 CSS 像素（= Tauri 逻辑像素），直接取 DOM 的
 *   `getBoundingClientRect()`；原生层永远画在 DOM 之上，被 DOM 浮层盖住的时候要 `hide`。
 * - 事件只从 Rust 往前端推：地址变化、标题、开始 / 结束加载。前进 / 后退能否用由前端
 *   导航 reducer 按地址事件推算（webview 本身不回报 history 长度）。
 *
 * **可选端口**：只有桌面壳有；浏览器开发版缺席时画布浏览器退回 iframe。
 */
export interface BrowserViewBounds {
  x: number
  y: number
  width: number
  height: number
}

export type BrowserViewEvent =
  | { kind: 'navigated'; url: string }
  | { kind: 'loadStarted'; url: string }
  | { kind: 'loadFinished'; url: string }
  | { kind: 'title'; title: string }

export interface BrowserViewOpenOptions {
  url: string
  bounds: BrowserViewBounds
  /** 打开时是否可见；Agent 的后台视图传 false */
  visible?: boolean
}

export interface BrowserViewPort {
  open(id: string, options: BrowserViewOpenOptions): Promise<void>
  navigate(id: string, url: string): Promise<void>
  back(id: string): Promise<void>
  forward(id: string): Promise<void>
  reload(id: string): Promise<void>
  stop(id: string): Promise<void>
  setBounds(id: string, bounds: BrowserViewBounds): Promise<void>
  show(id: string): Promise<void>
  hide(id: string): Promise<void>
  close(id: string): Promise<void>
  /** 订阅某个视图的事件；返回取消函数（同步可调，内部异步解绑） */
  subscribe(id: string, listener: (event: BrowserViewEvent) => void): () => void
}

export const CANVAS_BROWSER_VIEW_ID = 'canvas'

const VIEW_ID = /^[a-z0-9-]{1,32}$/

export function isBrowserViewId(id: string): boolean {
  return VIEW_ID.test(id)
}

/** 坐标取整并夹到非负：WebView2 对小数 / 负尺寸的处理不一致，统一在端口外收口 */
export function roundBrowserViewBounds(bounds: BrowserViewBounds): BrowserViewBounds {
  const x = Math.round(bounds.x)
  const y = Math.round(bounds.y)
  return {
    x,
    y,
    width: Math.max(0, Math.round(bounds.x + bounds.width) - x),
    height: Math.max(0, Math.round(bounds.y + bounds.height) - y),
  }
}

export function sameBrowserViewBounds(a: BrowserViewBounds | null, b: BrowserViewBounds): boolean {
  return Boolean(a) && a!.x === b.x && a!.y === b.y && a!.width === b.width && a!.height === b.height
}
