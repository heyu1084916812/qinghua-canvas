import {
  QUESTION_CARD_DEFAULT_LEAD,
  type AgentQuestion,
} from '../../../../domain/agent/questionCard'
import { stripQuestionCardEcho } from '../../../../domain/agent/questionCardReply'

/** 守卫只需要条目的这几个字段；用结构类型而不是 import conversation.ts，避免循环依赖。 */
type ProjectedItem =
  | { kind: 'step'; tool: string; failed: boolean; questions?: AgentQuestion[] }
  | { kind: 'text'; text: string }
  | { kind: 'process'; entries: { text: string; phase?: unknown }[] }
  | { kind: 'user' }

/**
 * 投影层守卫（2026-11-12 问题卡 UI）：发出问题卡的那一个用户回合里，正文与过程旁白中
 * 复述卡片题目 / 选项的编号清单一律剥掉 —— 题目只在问题卡里出现一次。
 * 正文剥空时留一句默认引导；过程旁白剥空则删掉该条。原地修改 toConversation 刚产出的条目。
 */
export function stripQuestionCardEchoes(out: { kind: string }[]): void {
  const items = out as ProjectedItem[]
  items.forEach((item, at) => {
    if (item.kind !== 'step' || item.tool !== 'askQuestions' || item.failed || !item.questions?.length) return
    const questions = item.questions
    let start = at
    while (start > 0 && items[start - 1]!.kind !== 'user') start -= 1
    let end = at
    while (end + 1 < items.length && items[end + 1]!.kind !== 'user') end += 1
    for (let index = start; index <= end; index += 1) {
      const row = items[index]!
      if (row.kind === 'text') {
        const text = stripQuestionCardEcho(row.text, questions)
        if (text !== row.text.trim()) items[index] = { ...row, text: text || QUESTION_CARD_DEFAULT_LEAD }
      } else if (row.kind === 'process') {
        row.entries = row.entries.flatMap((entry) => {
          if (entry.phase) return [entry]
          const text = stripQuestionCardEcho(entry.text, questions)
          if (text === entry.text.trim()) return [entry]
          return text ? [{ ...entry, text }] : []
        })
      }
    }
  })
}
