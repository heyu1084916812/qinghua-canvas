import {
  normalizeWebPageHandoff,
  type WebPageAgentHandoff,
} from '../../../../features/canvas/agentHandoff'
import type { ConversationResearchItem } from './conversation'

/**
 * 画布浏览器「交给 Agent」落到对话窗（对账 #1089，2026-11-13）：
 * - 页面图片 → 调研勾选 chip（`ConversationResearchItem`），沿用「勾选 → 发送时才进参考台账」流程；
 * - 地址与标题 → 输入框正文末尾一行「参考网页「标题」 地址」。
 */

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function stableHash(text: string): string {
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

export function webPageResearchItems(input: WebPageAgentHandoff): ConversationResearchItem[] {
  const page = normalizeWebPageHandoff(input)
  const source = hostOf(page.url) || '网页'
  return page.images.map((image) => ({
    id: `webpage-${stableHash(image.imageUrl)}`,
    title: image.title?.trim() || page.title || source,
    url: image.link?.trim() || page.url,
    imageUrl: image.imageUrl,
    source,
  }))
}

export function webPageDraftLine(page: Pick<WebPageAgentHandoff, 'url' | 'title'>): string {
  const title = page.title.trim()
  return title ? `参考网页「${title}」 ${page.url}` : `参考网页 ${page.url}`
}

/** 把参考网页这一行接到草稿末尾；同一行已经在里面就不重复。 */
export function appendWebPageLine(draft: string, line: string): string {
  if (draft.includes(line)) return draft
  const head = draft.replace(/\s+$/, '')
  return head ? `${head}\n${line}` : line
}
