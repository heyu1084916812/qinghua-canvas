/**
 * 「把选中的节点交给 agent 当素材」——画布侧与对话窗之间的**单例交接**。
 *
 * 用户 2026-10-05 第 11 条：多选虚线框上方那排功能里，最后一个动作是「添加到 agent
 * 作为素材」。两边的组件是**兄弟**（画布 surface 与对话窗都挂在 `CanvasPage` 的槽位上），
 * 直接互相调用要一路透传四层 props；这里用一个模块级单例接一下，和剪贴板
 * （`useClipboard.ts`）同一套路数：**不进 store、不参与撤销**，它只是一次交接。
 *
 * 两个订阅方各取所需：
 * - `CanvasPage`：有交接就把对话窗**打开**（用户点了按钮，面板得像样地弹出来）；
 * - `AgentPanel`：把 ids 收进当前会话的 `pendingAssetIds` 并补成正文 chip。
 */

const pendingByProject = new Map<string, string[]>()
const listenersByProject = new Map<
  string,
  Set<(ids: readonly string[]) => void>
>()

export interface AgentReferenceHandoff {
  id: string
  label: string
}

const pendingReferencesByProject = new Map<
  string,
  AgentReferenceHandoff[]
>()
const referenceListenersByProject = new Map<
  string,
  Set<(refs: readonly AgentReferenceHandoff[]) => void>
>()

/** 画布侧调用：把选中的节点交给 agent（多次调用会累积） */
export function sendSelectionToAgent(
  projectId: string,
  ids: readonly string[],
): void {
  if (!projectId || ids.length === 0) return
  const pending = [
    ...new Set([...pendingByProject.get(projectId) ?? [], ...ids]),
  ]
  pendingByProject.set(projectId, pending)
  for (const fn of listenersByProject.get(projectId) ?? []) fn(pending)
}

/**
 * 对话窗调用：**取走并清空**。
 *
 * 必须取走而不是读：否则每次切会话 / 重渲染都会再收一遍同一批节点，
 * 正文里就会冒出重复的 chip。
 */
export function takeAgentHandoff(projectId: string): string[] {
  const out = pendingByProject.get(projectId) ?? []
  pendingByProject.delete(projectId)
  return out
}

export function subscribeAgentHandoff(
  projectId: string,
  fn: (ids: readonly string[]) => void,
): () => void {
  let listeners = listenersByProject.get(projectId)
  if (!listeners) {
    listeners = new Set()
    listenersByProject.set(projectId, listeners)
  }
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
    if (listeners.size === 0) listenersByProject.delete(projectId)
  }
}

/** 参考卡交给 Agent：一张卡一枚 reference chip；同 id 累积去重。 */
export function sendReferenceToAgent(
  projectId: string,
  refs: readonly AgentReferenceHandoff[],
): void {
  if (!projectId || refs.length === 0) return
  const byId = new Map(
    (pendingReferencesByProject.get(projectId) ?? []).map((ref) => [ref.id, ref]),
  )
  for (const ref of refs) {
    if (!ref.id) continue
    byId.set(ref.id, { id: ref.id, label: ref.label.trim() || ref.id })
  }
  const pending = [...byId.values()]
  pendingReferencesByProject.set(projectId, pending)
  for (const fn of referenceListenersByProject.get(projectId) ?? []) fn(pending)
}

export function takeReferenceAgentHandoff(
  projectId: string,
): AgentReferenceHandoff[] {
  const out = pendingReferencesByProject.get(projectId) ?? []
  pendingReferencesByProject.delete(projectId)
  return out
}

export function subscribeReferenceAgentHandoff(
  projectId: string,
  fn: (refs: readonly AgentReferenceHandoff[]) => void,
): () => void {
  let listeners = referenceListenersByProject.get(projectId)
  if (!listeners) {
    listeners = new Set()
    referenceListenersByProject.set(projectId, listeners)
  }
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
    if (listeners.size === 0) referenceListenersByProject.delete(projectId)
  }
}

/**
 * 画布浏览器「交给 Agent」（对账 #1089，2026-11-13）：当前网页的地址、标题与页面图片。
 * 图片在对话窗里挂成调研勾选 chip（发送时才进参考台账），地址与标题写进输入框正文。
 * iframe 退回（读不到跨域 DOM）时 `images` 为空，只交地址与标题。
 */
export interface WebPageAgentImage {
  /** 原图地址（http/https）。 */
  imageUrl: string
  /** 图片所在的原帖 / 详情页；没有就用网页地址。 */
  link?: string
  title?: string
}

export interface WebPageAgentHandoff {
  url: string
  title: string
  images: WebPageAgentImage[]
}

/** 一次交接最多带多少张（页面图片已按尺寸过滤；再多输入框就挂满了）。 */
export const WEB_PAGE_HANDOFF_IMAGE_LIMIT = 12

/** 只留 http(s) 图片、按地址去重、截到上限。 */
export function normalizeWebPageHandoff(page: WebPageAgentHandoff): WebPageAgentHandoff {
  const seen = new Set<string>()
  const images: WebPageAgentImage[] = []
  for (const image of page.images) {
    const imageUrl = image.imageUrl.trim()
    if (!/^https?:\/\//i.test(imageUrl) || seen.has(imageUrl)) continue
    seen.add(imageUrl)
    images.push({ ...image, imageUrl })
    if (images.length >= WEB_PAGE_HANDOFF_IMAGE_LIMIT) break
  }
  return { url: page.url.trim(), title: page.title.trim(), images }
}

const pendingPagesByProject = new Map<string, WebPageAgentHandoff[]>()
const pageListenersByProject = new Map<
  string,
  Set<(pages: readonly WebPageAgentHandoff[]) => void>
>()

/**
 * 画布浏览器调用：把当前网页交给 agent（同一地址再交一次 = 用新的一份替换旧的）。
 * 返回实际交出去的那一份（去重截断后），没交出去返回 null。
 */
export function sendWebPageToAgent(
  projectId: string,
  input: WebPageAgentHandoff,
): WebPageAgentHandoff | null {
  const page = normalizeWebPageHandoff(input)
  if (!projectId || !/^https?:\/\//i.test(page.url)) return null
  const pending = [
    ...(pendingPagesByProject.get(projectId) ?? []).filter((row) => row.url !== page.url),
    page,
  ]
  pendingPagesByProject.set(projectId, pending)
  for (const fn of pageListenersByProject.get(projectId) ?? []) fn(pending)
  return page
}

/** 对话窗调用：取走并清空（同 `takeAgentHandoff`，防止重复挂 chip）。 */
export function takeWebPageAgentHandoff(
  projectId: string,
): WebPageAgentHandoff[] {
  const out = pendingPagesByProject.get(projectId) ?? []
  pendingPagesByProject.delete(projectId)
  return out
}

export function subscribeWebPageAgentHandoff(
  projectId: string,
  fn: (pages: readonly WebPageAgentHandoff[]) => void,
): () => void {
  let listeners = pageListenersByProject.get(projectId)
  if (!listeners) {
    listeners = new Set()
    pageListenersByProject.set(projectId, listeners)
  }
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
    if (listeners.size === 0) pageListenersByProject.delete(projectId)
  }
}

/** 项目删除后同时清掉未消费交接与陈旧订阅，恢复项目时会重新注册。 */
export function clearAgentHandoff(projectId: string): void {
  pendingByProject.delete(projectId)
  listenersByProject.delete(projectId)
  pendingReferencesByProject.delete(projectId)
  referenceListenersByProject.delete(projectId)
  pendingPagesByProject.delete(projectId)
  pageListenersByProject.delete(projectId)
}
