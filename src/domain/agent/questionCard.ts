import type { ChatMessage } from '../shared/execution/types'

/**
 * 问题卡（questions[]）：开工前一次问清几个关键缺口，每题给可选项 + 自由输入。
 *
 * Lovart 对照（review/lovart-agent-interview.md）：缺少决定成品方向的关键信息（尺寸、核心文案、
 * 多张参考图各自怎么用）时，先发问题卡；选项是快捷候选（单选或多选），同时附自由输入框。
 * 以前轻画只能用 requestTaskConfirmation 的 clarification「一次问一个问题」，而且必须先有计划。
 *
 * 问题卡不是确认卡：它不暂停工具、不走确认执行路径。Agent 调用 `askQuestions` 后本回合结束，
 * 用户的回答作为下一条普通消息发回（同一任务的延续，见 agentTask.ts 的 answersQuestionCard）。
 * 题目可带 referenceItemId（G9）：回答会作为最高优先级约束交给参考分析，重写那张参考卡的用法。
 */

export const QUESTION_CARD_TOOL = 'askQuestions'
export const QUESTION_CARD_MAX_QUESTIONS = 4
export const QUESTION_CARD_MAX_OPTIONS = 6
const QUESTION_LIMIT = 120
const OPTION_LIMIT = 40

export interface AgentQuestion {
  id: string
  question: string
  options: string[]
  /** true = 可多选；缺省单选。 */
  multiple: boolean
  /** 是否附自由输入框；缺省 true（Lovart：候选之外可直接填写）。 */
  allowFreeText: boolean
  /** G9：这题问的是哪张参考卡的用法；回答会写回该卡当前任务的 howToUse。 */
  referenceItemId?: string
}

export interface AgentQuestionAnswer {
  questionId: string
  selected: string[]
  freeText: string
}

export type ParsedQuestionCard =
  | { ok: true; questions: AgentQuestion[]; intro: string }
  | { ok: false; problems: string[] }

function clip(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : ''
}

export function parseQuestionCardArgs(args: unknown): ParsedQuestionCard {
  const record = args && typeof args === 'object' && !Array.isArray(args)
    ? (args as Record<string, unknown>)
    : {}
  const raw = Array.isArray(record.questions) ? record.questions : []
  const problems: string[] = []
  if (raw.length === 0) problems.push('questions 至少要有 1 题')
  if (raw.length > QUESTION_CARD_MAX_QUESTIONS) {
    problems.push(`一次最多问 ${QUESTION_CARD_MAX_QUESTIONS} 题，只问会改变结果的关键缺口`)
  }
  const questions: AgentQuestion[] = []
  const seen = new Set<string>()
  raw.slice(0, QUESTION_CARD_MAX_QUESTIONS).forEach((entry, index) => {
    const row = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {}
    const question = clip(row.question, QUESTION_LIMIT)
    if (!question) {
      problems.push(`第 ${index + 1} 题缺少 question`)
      return
    }
    const options = [...new Set(
      (Array.isArray(row.options) ? row.options : [])
        .map((option) => clip(option, OPTION_LIMIT))
        .filter(Boolean),
    )].slice(0, QUESTION_CARD_MAX_OPTIONS)
    const allowFreeText = row.allowFreeText !== false
    if (options.length === 0 && !allowFreeText) {
      problems.push(`第 ${index + 1} 题既没有选项也不允许自由输入，用户无法回答`)
      return
    }
    let id = clip(row.id, 40) || `q${index + 1}`
    if (seen.has(id)) id = `${id}-${index + 1}`
    seen.add(id)
    const referenceItemId = clip(row.referenceItemId, 80)
    questions.push({
      id,
      question,
      options,
      multiple: row.multiple === true,
      allowFreeText,
      ...(referenceItemId ? { referenceItemId } : {}),
    })
  })
  if (problems.length > 0) return { ok: false, problems }
  return { ok: true, questions, intro: clip(record.intro, QUESTION_LIMIT) }
}

/**
 * Agent 循环里处理一次 askQuestions：返回要写入历史的工具结果，以及本回合结束时的正文。
 * 参数不合法时 text 为 null：把问题回填给模型，让它改了再问（回合不结束）。
 */
export function questionCardTurn(
  callId: string,
  args: unknown,
): { toolMessage: ChatMessage; text: string | null } {
  const card = parseQuestionCardArgs(args)
  const result = card.ok
    ? { ok: true, awaitingAnswers: true, intro: card.intro, questions: card.questions }
    : { ok: false, problems: card.problems }
  return {
    toolMessage: {
      role: 'tool',
      toolCallId: callId,
      toolName: QUESTION_CARD_TOOL,
      content: JSON.stringify(result),
      createdAt: Date.now(),
    },
    text: card.ok ? questionCardText(card.intro, card.questions) : null,
  }
}

export const QUESTION_CARD_DEFAULT_LEAD = '开工前先定几件事。'

/**
 * 本回合结束时显示的正文：**只留一句引导**（用户 2026-11-12：正文把问题与选项又写一遍，和问题卡重复）。
 * 问题与选项只在问题卡里出现；工具结果里仍有完整题目，模型下一回合照样看得到。
 * intro 若被模型写成了题目清单，先按卡片题目剥掉（stripQuestionCardEcho）。
 */
export function questionCardText(intro: string, questions: readonly AgentQuestion[]): string {
  const lead = stripQuestionCardEcho(intro, questions).replace(/\s+/g, ' ').trim()
  return lead || QUESTION_CARD_DEFAULT_LEAD
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
function echoesQuestion(line: string, questions: readonly AgentQuestion[]): boolean {
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
function echoesOptions(line: string, questions: readonly AgentQuestion[]): boolean {
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
export function stripQuestionCardEcho(text: string, questions: readonly AgentQuestion[]): string {
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

/** 把问题卡的回答整理成一条用户消息。没答的题写「未回答」，让 Agent 自行按默认处理或再问。 */
export function formatQuestionAnswers(
  questions: readonly AgentQuestion[],
  answers: readonly AgentQuestionAnswer[],
): string {
  const byId = new Map(answers.map((answer) => [answer.questionId, answer]))
  return [
    QUESTION_CARD_ANSWER_HEADER,
    ...questions.map((question, index) => {
      const answer = byId.get(question.id)
      const parts = [
        ...(answer?.selected ?? []).filter((option) => question.options.includes(option)),
        ...(answer?.freeText.trim() ? [answer.freeText.trim()] : []),
      ]
      return `${index + 1}. ${question.question} → ${parts.length > 0 ? parts.join('；') : '未回答'}`
    }),
  ].join('\n')
}

export const QUESTION_CARD_ANSWER_HEADER = '问题卡回答：'
export const QUESTION_CARD_SKIP_HEADER = '问题卡回答：已跳过，按你的判断继续，同一任务不要再问这些问题。'

/**
 * 「跳过」：一题不答，本回合按 Agent 自己的推断继续（同 G8 的自动补齐），同一任务不再问这些题。
 * 仍是一条普通用户消息（同一任务延续）；题目逐条写「未回答」，G9 不会把它当成参考用法约束。
 */
export function formatQuestionSkip(questions: readonly AgentQuestion[]): string {
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

function answerOf(
  answers: readonly AgentQuestionAnswer[],
  questionId: string,
): AgentQuestionAnswer {
  return answers.find((answer) => answer.questionId === questionId) ?? {
    questionId,
    selected: [],
    freeText: '',
  }
}

function withAnswer(
  answers: readonly AgentQuestionAnswer[],
  next: AgentQuestionAnswer,
): AgentQuestionAnswer[] {
  const rest = answers.filter((answer) => answer.questionId !== next.questionId)
  return [...rest, next]
}

/** 点一个选项：单选题替换、再点取消；多选题切换（保持选项原顺序）。 */
export function toggleQuestionOption(
  answers: readonly AgentQuestionAnswer[],
  question: AgentQuestion,
  option: string,
): AgentQuestionAnswer[] {
  if (!question.options.includes(option)) return [...answers]
  const current = answerOf(answers, question.id)
  const has = current.selected.includes(option)
  const selected = question.multiple
    ? question.options.filter((candidate) =>
        candidate === option ? !has : current.selected.includes(candidate),
      )
    : has
      ? []
      : [option]
  return withAnswer(answers, { ...current, selected })
}

export function setQuestionFreeText(
  answers: readonly AgentQuestionAnswer[],
  question: AgentQuestion,
  freeText: string,
): AgentQuestionAnswer[] {
  if (!question.allowFreeText) return [...answers]
  return withAnswer(answers, { ...answerOf(answers, question.id), freeText })
}

export function questionCardAnswerable(
  questions: readonly AgentQuestion[],
  answers: readonly AgentQuestionAnswer[],
): boolean {
  return answers.some(
    (answer) =>
      (answer.selected.length > 0 && questions.some((q) => q.id === answer.questionId)) ||
      answer.freeText.trim().length > 0,
  )
}

/**
 * 历史里最后一张问题卡；它之后已有用户消息时视为已回答（answered=true）。
 * 只认成功的 askQuestions 工具结果。
 */
export function latestQuestionCard(
  messages: readonly ChatMessage[],
): { callId: string; questions: AgentQuestion[]; answered: boolean } | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!
    if (message.role !== 'tool' || message.toolName !== QUESTION_CARD_TOOL) continue
    let payload: unknown
    try {
      payload = JSON.parse(message.content)
    } catch {
      return null
    }
    const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
    if (record.ok !== true) return null
    const parsed = parseQuestionCardArgs(record)
    if (!parsed.ok) return null
    const answered = messages.slice(index + 1).some((row) => row.role === 'user')
    return { callId: message.toolCallId ?? '', questions: parsed.questions, answered }
  }
  return null
}

const ANSWER_LINE = /^(\d+)\.\s.*?\s→\s(.+)$/

/**
 * G9：从问题卡回答消息（formatQuestionAnswers 的格式）里取出每张参考卡的回答原话。
 * 只认带 referenceItemId 的题；「未回答」不算。消息不是问题卡格式（用户直接在输入框里答）时返回空，
 * 由调用方决定是否把整句当作回答。
 */
export function questionAnswersByReference(
  questions: readonly AgentQuestion[],
  text: string,
): Record<string, string> {
  const answers: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const match = ANSWER_LINE.exec(line.trim())
    if (!match) continue
    const question = questions[Number(match[1]) - 1]
    const answer = match[2]!.trim()
    if (!question?.referenceItemId || !answer || answer === '未回答') continue
    const previous = answers[question.referenceItemId]
    answers[question.referenceItemId] = previous
      ? `${previous}；${question.question} → ${answer}`
      : `${question.question} → ${answer}`
  }
  return answers
}
