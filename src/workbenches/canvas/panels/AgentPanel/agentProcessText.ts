import type { ConversationProcessEntry } from './conversation'

/**
 * The collapsed row is a headline, not a transcript. Keep the newest complete
 * sentence (or newest line) and leave the full accumulated text in the fold.
 */
export function latestProcessLine(text: string): string {
  const rows = text
    .split(/\r?\n|(?<=[。！？!?])\s*/u)
    .map((row) => row.trim())
    .filter(Boolean)
  return rows.at(-1) ?? ''
}

/**
 * 展开区里“实时过程正文”和“已落消息历史”可能是同一段内容的两帧。
 * 只保留更靠后的一帧，避免工具调用时出现上方一个框、下方又一行同样的文字。
 */
export function expandedProcessView<T extends { text: string }>(
  history: readonly T[],
  processText: string,
): { liveText: string; rows: readonly T[] } {
  const liveText = processText.trim()
  if (!liveText || history.length === 0) {
    return { liveText, rows: history }
  }
  const latestIndex = history.length - 1
  const latest = history[latestIndex]!
  const latestText = latest.text.trim()
  if (liveText === latestText || liveText.startsWith(latestText)) {
    return {
      liveText,
      rows: history.slice(0, latestIndex),
    }
  }
  if (latestText.startsWith(liveText)) {
    return { liveText: '', rows: history }
  }
  return { liveText, rows: history }
}

export function isAdvanceTaskCommand(text: string): boolean {
  const normalized = text.replace(/[\s，。！？!?、]/g, '').toLowerCase()
  return new Set([
    '直接下一步',
    '下一步',
    '直接进入下一步',
    '跳过验收',
    '跳过验收直接下一步',
  ]).has(normalized)
}

/**
 * 已完成阶段优先用事实摘要做折叠标题；没有阶段事件时保留原来的「最新过程行」。
 * 运行中不用它，避免把尚未完成的阶段包装成结论。
 */
export function collapsedProcessHeadline(
  history: readonly ConversationProcessEntry[],
  processText: string,
): string {
  const phaseEntry = [...history]
    .reverse()
    .find((entry) => entry.phase && entry.collapsedSummary)
  return phaseEntry?.collapsedSummary || latestProcessLine(processText)
}
