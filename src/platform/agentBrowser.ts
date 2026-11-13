/**
 * Agent 后台浏览器端口（2026-11-13，对账 #1087）。
 *
 * 桌面壳里是一个**隐藏的独立 WebviewWindow**（label `agent-browser-<id>`），与画布浏览器
 * **共用同一份浏览器数据目录**：用户在画布浏览器里登录过的站，Agent 这边直接带登录态。
 * 用来抓只能在真实浏览器里打开的设计站（Dribbble / Packaging of the World / Pinterest；The Dieline 2026-11-14 起改为 REST 直连）。
 *
 * - `load`：导航 → 等加载完成 → 往下滚几屏（懒加载）→ 执行 `script`（必须同步返回
 *   `JSON.stringify(...)` 字符串），把脚本结果原样交回；
 * - 遇到验证码 / 登录墙：`show` 把窗口亮给用户，用户处理完 `hide` 再重新 `load`；
 * - 用户直接关掉亮出来的窗口：壳只把它隐藏，并发 `closed` 事件。
 *
 * **可选端口**：只有桌面壳有；浏览器开发版缺席，浏览器站点如实报 `needs-browser`。
 */
export interface AgentBrowserLoadOptions {
  /** 等加载完成的总时限（毫秒，壳里夹到 3–60s，缺省 25s）。 */
  timeoutMs?: number
  /** 滚动后再等多久（毫秒，0–5s，缺省 1.2s）。 */
  settleMs?: number
  /** 往下滚几屏（0–8，缺省 3）。 */
  scrollSteps?: number
}

export type AgentBrowserEvent = { kind: 'closed' }

export interface AgentBrowserPort {
  load(id: string, url: string, script: string, options?: AgentBrowserLoadOptions): Promise<string>
  /** 不跳转，在当前页执行脚本。 */
  snapshot(id: string, script: string): Promise<string>
  show(id: string, title?: string): Promise<void>
  hide(id: string): Promise<void>
  close(id: string): Promise<void>
  /** 订阅某个窗口的事件；返回取消函数。 */
  subscribe(id: string, listener: (event: AgentBrowserEvent) => void): () => void
}
