import type { ChatMessage } from '../../../domain/shared/execution/types'
import { PRESET_MODELS, presetIdForUpstream } from '../../../domain/project/modelPresets'

/**
 * 完成说明核对（Agent 实测 Bug A7，2026-11-11）。
 *
 * 实测：Agent 说「3:4 竖版 2K」，readResult 对应产物实际是 1086×1448；
 * 也出现过把出图模型说成另一个模型。完成说明里的**尺寸 / 张数 / 出图模型**
 * 必须来自本轮真实结果：runNode 的 outcomes（实际模型）与运行后的 readResult（产物与像素）。
 *
 * 纯函数：只读消息序列，不碰画布 / 渠道。主循环经 `agentCanvasClaimGuard` 调用。
 */

export interface ResultOutputFact {
  nodeId: string
  title?: string
  width?: number
  height?: number
}

export interface TurnResultFacts {
  /** 本轮是否执行过 runNode / runFrom（有执行结果） */
  ran: boolean
  /** 最后一次执行之后是否调用过 readResult */
  readAfterRun: boolean
  /** 最后一次执行之后 readResult 报告的产物（按 hash 去重） */
  outputs: ResultOutputFact[]
  /** runNode outcomes 里实际发送的模型 */
  models: string[]
}

const RUN_TOOLS = new Set(['runNode', 'runFrom'])
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const parse = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export function turnResultFacts(messages: readonly ChatMessage[]): TurnResultFacts {
  let start = 0
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!
    if (message.role === 'user' && !message.hiddenFromConversation) {
      start = index + 1
      break
    }
  }
  const nameOf = new Map<string, string>()
  for (const message of messages) {
    for (const call of message.toolCalls ?? []) nameOf.set(call.id, call.name)
  }
  const facts: TurnResultFacts = { ran: false, readAfterRun: false, outputs: [], models: [] }
  const seen = new Set<string>()
  for (let index = start; index < messages.length; index += 1) {
    const message = messages[index]!
    if (message.role !== 'tool') continue
    const name = message.toolName || nameOf.get(message.toolCallId ?? '') || ''
    const body = record(parse(message.content))
    if (RUN_TOOLS.has(name)) {
      facts.ran = true
      facts.readAfterRun = false
      facts.outputs = []
      seen.clear()
      for (const outcome of list(body.outcomes).map(record)) {
        if (typeof outcome.model === 'string' && outcome.model && !facts.models.includes(outcome.model)) {
          facts.models.push(outcome.model)
        }
      }
      continue
    }
    if (name !== 'readResult' || !facts.ran) continue
    facts.readAfterRun = true
    for (const result of list(body.results).map(record)) {
      if (result.status !== 'ok') continue
      for (const output of list(result.outputs).map(record)) {
        const hash = typeof output.hash === 'string' ? output.hash : ''
        if (!hash || seen.has(hash)) continue
        seen.add(hash)
        facts.outputs.push({
          nodeId: String(result.nodeId ?? ''),
          ...(typeof result.title === 'string' && result.title ? { title: result.title } : {}),
          ...(typeof output.width === 'number' && typeof output.height === 'number'
            ? { width: output.width, height: output.height }
            : {}),
        })
      }
    }
  }
  return facts
}

const K_CLAIM = /(?<![\w.])([1248])\s*K(?![a-zA-Z])/g
const SIZE_CLAIM = /(\d{3,5})\s*[×xX*]\s*(\d{3,5})/g
const COUNT_SENTENCE = /(生成|出图|出了|共|一共|总共)/
const COUNT_CLAIM = /(\d+|[一两二三四五六七八九十])\s*张/
const CN_NUMBER: Record<string, number> = {
  一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
}

const sizeText = (output: ResultOutputFact) =>
  output.width && output.height ? `${output.width}×${output.height}` : '尺寸未知'

function claimedCount(text: string): number | null {
  for (const sentence of text.split(/[。！？!?\n；;]/)) {
    if (!COUNT_SENTENCE.test(sentence)) continue
    const hit = sentence.match(COUNT_CLAIM)
    if (!hit) continue
    const raw = hit[1]!
    return /^\d+$/.test(raw) ? Number(raw) : (CN_NUMBER[raw] ?? null)
  }
  return null
}

function claimedPresetModels(text: string): string[] {
  const lower = text.toLowerCase()
  return PRESET_MODELS.filter(
    (model) => (model.category === 'image' || model.category === 'video') && lower.includes(model.id.toLowerCase()),
  ).map((model) => model.id)
}

/** 完成说明里与真实结果不符的地方；空数组 = 没有需要核对的说法，或全部属实 */
export function resultClaimProblems(text: string, facts: TurnResultFacts): string[] {
  if (!facts.ran) return []
  const kClaims = [...text.matchAll(K_CLAIM)].map((match) => Number(match[1]))
  const sizeClaims = [...text.matchAll(SIZE_CLAIM)].map((match) => [Number(match[1]), Number(match[2])])
  const count = claimedCount(text)
  const problems: string[] = []
  const models = claimedPresetModels(text)
  if (facts.models.length > 0) {
    for (const model of models) {
      const used = facts.models.some(
        (sent) => sent === model || presetIdForUpstream(sent) === model,
      )
      if (!used) problems.push(`说由「${model}」出图，但本轮运行记录里实际模型是 ${facts.models.join('、')}`)
    }
  }
  if (kClaims.length === 0 && sizeClaims.length === 0 && count === null) return problems
  if (!facts.readAfterRun) {
    return [...problems, '报了尺寸 / 张数，但本轮运行后还没有调用 readResult 核对真实产物']
  }
  const sized = facts.outputs.filter((output) => output.width && output.height)
  const actual = facts.outputs.map(sizeText).join('、') || '无产物'
  if ((kClaims.length > 0 || sizeClaims.length > 0) && sized.length === 0) {
    problems.push(`readResult 没有尺寸信息（${actual}），不能声称具体尺寸或 ${kClaims.map((k) => `${k}K`).join('/') || '像素'}`)
  } else {
    for (const k of kClaims) {
      const ok = sized.some((output) => Math.max(output.width!, output.height!) >= k * 1024 * 0.85)
      if (!ok) problems.push(`声称 ${k}K，但实际产物是 ${actual}`)
    }
    for (const [w, h] of sizeClaims) {
      const ok = sized.some(
        (output) => (output.width === w && output.height === h) || (output.width === h && output.height === w),
      )
      if (!ok) problems.push(`声称 ${w}×${h}，但实际产物是 ${actual}`)
    }
  }
  if (count !== null && count !== facts.outputs.length) {
    problems.push(`声称 ${count} 张，但 readResult 实际是 ${facts.outputs.length} 张`)
  }
  return problems
}

/** 真实结果的一行事实（核对仍不符时附在回答末尾） */
export function resultFactsLine(facts: TurnResultFacts): string {
  if (!facts.readAfterRun) return '实际结果：本轮运行后尚未经 readResult 核对，尺寸与张数以画布为准。'
  const parts = facts.outputs.map((output) => `「${output.title ?? '产物'}」${sizeText(output)}`)
  return `实际结果（readResult 核对）：${parts.join('、') || '无产物'}；共 ${facts.outputs.length} 张。`
}
