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
    questions.push({ id, question, options, multiple: row.multiple === true, allowFreeText })
  })
  if (problems.length > 0) return { ok: false, problems }
  return { ok: true, questions, intro: clip(record.intro, QUESTION_LIMIT) }
}

/** 本回合结束时显示的正文；不渲染问题卡的环境（导出、JSON 模式）也能看懂。 */
export function questionCardText(intro: string, questions: readonly AgentQuestion[]): string {
  return [
    intro || '开始之前，想先和你确认几件事：',
    ...questions.map((question, index) => {
      const options = question.options.length > 0
        ? `（${question.options.join(' / ')}${question.allowFreeText ? ' / 或直接写' : ''}）`
        : ''
      return `${index + 1}. ${question.question}${options}`
    }),
    '在下方问题卡里选择或填写后提交，我再接着做。',
  ].join('\n')
}

/** 把问题卡的回答整理成一条用户消息。没答的题写「未回答」，让 Agent 自行按默认处理或再问。 */
export function formatQuestionAnswers(
  questions: readonly AgentQuestion[],
  answers: readonly AgentQuestionAnswer[],
): string {
  const byId = new Map(answers.map((answer) => [answer.questionId, answer]))
  return [
    '问题卡回答：',
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
