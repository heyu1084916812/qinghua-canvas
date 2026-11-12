/**
 * 问题卡回合的「正文 / 回答」投影（2026-11-12 Lovart 样式问题卡）：
 * - stripQuestionCardEcho：发问题卡的回合正文只留引导句，剥掉复述卡片题目 / 选项的清单；
 * - formatQuestionSkip / isQuestionCardSkip：「跳过」= 按 Agent 推断继续，不当成参考约束；
 * - parseQuestionCardAnswerMessage：回答消息还原成「题 → 答」，供折叠摘要显示。
 * 只依赖题目的文字结构，不依赖 questionCard.ts（避免循环依赖）。
 */

/** 守卫与跳过只需要题目文字与选项。 */
export interface CardQuestionText {
  question: string
  options: readonly string[]
}

function normalizedQuestion(text: string): string {
  return text
    .replace(/[*_`#>]/g, '')
    .replace(/[\s:：?？。.,，、!！（）()「」“”"'【】[\]/／]/g, '')
    .toLowerCase()
}

const LIST_ITEM = /^\s*(?:\d{1,2}[.、)）]|[-*•·]|[（(]\d{1,2}[)）]|Q\d{1,2}[.:：]?)\s*/i
const CARD_HINT = /问题卡.{0,16}(?:选择|填写|提交|回答)|(?:选择|填写).{0,12}后提交/

/** 这一行是不是在复述卡片里的某一题（题干前 12 个有效字符互相包含即算）。 */
function echoesQuestion(line: string, questions: readonly CardQuestionText[]): boolean {
  const body = normalizedQuestion(line.replace(LIST_ITEM, ''))
  if (body.length < 2) return false
  return questions.some((question) => {
    const q = normalizedQuestion(question.question)
    if (q.length < 2) return false
    // 很短的题干（如「尺寸？」）只认行首，避免误伤正文里顺带提到的词
    if (q.length < 4 || body.length < 4) return body.startsWith(q)
    const head = q.slice(0, Math.min(12, q.length))
    return body.includes(head) || q.startsWith(body.slice(0, Math.min(12, body.length)))
  })
}

/** 这一行是不是在罗列卡片里的选项（同一题有 ≥2 个选项原文出现在这一行；只有 1 个选项的题出现 1 个即算）。 */
function echoesOptions(line: string, questions: readonly CardQuestionText[]): boolean {
  const body = normalizedQuestion(line)
  if (!body) return false
  return questions.some((question) => {
    if (question.options.length === 0) return false
    const hits = question.options.filter((option) => {
      const o = normalizedQuestion(option)
      return o.length >= 2 && body.includes(o)
    }).length
    return hits >= Math.min(2, question.options.length)
  })
}

/**
 * 投影层守卫：发问题卡的回合，正文里与卡片重复的题目清单（编号 / 项目符号行及其下的选项子行）
 * 和「在下方问题卡里选择…」提示整行剥掉，只留引导句。提示词也要求只写一句引导，这里兜底
 * 模型不听话与旧会话（旧版 questionCardText 自己就会写整份清单）。
 */
export function stripQuestionCardEcho(text: string, questions: readonly CardQuestionText[]): string {
  if (!text.trim() || questions.length === 0) return text.trim()
  const kept: string[] = []
  let dropping = false
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) {
      dropping = false
      kept.push('')
      continue
    }
    if (CARD_HINT.test(trimmed)) continue
    const listItem = LIST_ITEM.test(line)
    if (echoesQuestion(trimmed, questions) && (listItem || trimmed.length <= 160)) {
      dropping = true
      continue
    }
    const indented = /^\s{2,}/.test(line) || /^\s*[-*•·]\s/.test(line)
    if (dropping && (indented || echoesOptions(trimmed, questions))) continue
    if (listItem && echoesOptions(trimmed, questions)) {
      dropping = true
      continue
    }
    dropping = false
    kept.push(line)
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

export const QUESTION_CARD_ANSWER_HEADER = '问题卡回答：'
export const QUESTION_CARD_SKIP_HEADER = '问题卡回答：已跳过，按你的判断继续，同一任务不要再问这些问题。'

/**
 * 「跳过」：一题不答，本回合按 Agent 自己的推断继续（同 G8 的自动补齐），同一任务不再问这些题。
 * 仍是一条普通用户消息（同一任务延续）；题目逐条写「未回答」，G9 不会把它当成参考用法约束。
 */
export function formatQuestionSkip(questions: readonly CardQuestionText[]): string {
  return [
    QUESTION_CARD_SKIP_HEADER,
    ...questions.map((question, index) => `${index + 1}. ${question.question} → 未回答`),
  ].join('\n')
}

export function isQuestionCardSkip(text: string): boolean {
  return text.trim().startsWith(QUESTION_CARD_SKIP_HEADER)
}

export interface QuestionCardAnswerSummary {
  skipped: boolean
  rows: { question: string; answer: string }[]
  answeredCount: number
}

/** 把一条问题卡回答消息还原成「题 → 答」，供折叠摘要（已回答 N 题 / 已跳过）显示。不是这种格式返回 null。 */
export function parseQuestionCardAnswerMessage(text: string): QuestionCardAnswerSummary | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith(QUESTION_CARD_ANSWER_HEADER)) return null
  const rows: { question: string; answer: string }[] = []
  for (const line of trimmed.split(/\r?\n/).slice(1)) {
    const match = /^\d+\.\s(.*?)\s→\s(.+)$/.exec(line.trim())
    if (match) rows.push({ question: match[1]!.trim(), answer: match[2]!.trim() })
  }
  if (rows.length === 0) return null
  const skipped = isQuestionCardSkip(trimmed)
  return {
    skipped,
    rows,
    answeredCount: skipped ? 0 : rows.filter((row) => row.answer !== '未回答').length,
  }
}
