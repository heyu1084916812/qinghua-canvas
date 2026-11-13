import type { WebPageAgentHandoff } from '../../../features/canvas/agentHandoff'
import type { BrowserViewPort } from '../../../platform/browserView'
import {
  isPageSnapshot,
  pageExtractScript,
  parsePageSnapshot,
} from '../../../features/shared/research/siteAdapters/pageSnapshot'

/**
 * 画布浏览器「交给 Agent」取当前网页（对账 #1089，2026-11-13）。
 *
 * 原生视图：在当前页执行与 Agent 浏览器同一段自包含提取脚本（`pageExtractScript`），
 * 拿到图片（srcset 挑大图、懒加载 data-src、CSS 背景图、尺寸过滤）与所在原帖链接；
 * 脚本超时 / 认不出 / 端口没有 `extract`（iframe 退回）时只交地址与标题。
 */
export const BROWSER_AGENT_EXTRACT_LIMIT = 40

export interface BrowserAgentPageResult {
  page: WebPageAgentHandoff
  /** 是否真的读到了页面（false = 只交了地址与标题）。 */
  extracted: boolean
}

export async function readBrowserPageForAgent(input: {
  url: string
  title: string
  viewId: string
  /** 原生视图在用时传端口；iframe 退回时传 null。 */
  view: Pick<BrowserViewPort, 'extract'> | null
}): Promise<BrowserAgentPageResult> {
  const fallback: BrowserAgentPageResult = {
    page: { url: input.url, title: input.title.trim(), images: [] },
    extracted: false,
  }
  const extract = input.view?.extract
  if (!extract) return fallback
  let raw: string
  try {
    raw = await extract.call(input.view, input.viewId, pageExtractScript({ maxImages: BROWSER_AGENT_EXTRACT_LIMIT }))
  } catch {
    return fallback
  }
  const snapshot = parsePageSnapshot(raw)
  if (!isPageSnapshot(snapshot)) return fallback
  return {
    page: {
      // 页面可能已经跳到别处（重定向 / 站内导航），以脚本读到的为准
      url: /^https?:\/\//i.test(snapshot.url) ? snapshot.url : input.url,
      title: snapshot.title.trim() || input.title.trim(),
      images: snapshot.images.map((image) => ({
        imageUrl: image.src,
        ...(image.link ? { link: image.link } : {}),
        ...(image.title || image.alt ? { title: image.title || image.alt } : {}),
      })),
    },
    extracted: true,
  }
}

/** `sent` 是 `sendWebPageToAgent` 实际交出去的那一份（去重截断后）。 */
export function browserAgentStatus(extracted: boolean, sent: WebPageAgentHandoff | null): string {
  if (!sent) return '这个页面没有可交给 Agent 的地址。'
  if (!extracted) return '已把网页地址交给 Agent（读不到这个页面的图片）。'
  const staged = sent.images.length
  return staged > 0
    ? `已交给 Agent：网页地址 + ${staged} 张图片（发送前可在输入框里删掉不要的）。`
    : '已把网页地址交给 Agent（这个页面没有可用的图片）。'
}
