import type { ChatMessage } from '../../../domain/shared/execution/types'
import type { AgentLoopActivity } from './agentLoop'
import { toolResultFailed } from './agentCanvasClaimGuard'

const VISUAL_DENIAL =
  /(看不了|看不到|无法查看|不能查看|不能看|无法读取|不支持图片|不具备视觉|没有视觉能力|纯文本模型)/

const VISUAL_REQUEST =
  /(视觉验收|检查作品|巡检画布|质量把关|是否一致|有没有问题)/

export function deniesVisualCapability(text: string): boolean {
  return VISUAL_DENIAL.test(text) && /(图|图片|画布|视觉|模型)/.test(text)
}

export function requestsExplicitVisualReview(text: string): boolean {
  return VISUAL_REQUEST.test(text) || /验收|一致性|错字|质量把关/.test(text)
}

/** 模型自述不是执行证据；只有可读图片输入 + 已提供视觉工具才能补查。 */
export function visualEvidenceToCheck(
  messages: readonly ChatMessage[],
  text: string,
  tools: ReadonlySet<string>,
): boolean {
  // 主对话已有图片时必须让它自行理解，不得把普通看图抢占成视觉验收。
  if (!tools.has('visualReview')) return false
  const userText = [...messages]
    .reverse()
    .find((message) => message.role === 'user')?.content ?? ''
  return deniesVisualCapability(text) && requestsExplicitVisualReview(userText)
}

export async function reviewBeforeVisualDenial(input: {
  messages: ChatMessage[]
  text: string
  step: number
  tools: ReadonlySet<string>
  hasImageInputs: boolean
  executeRead: (name: string, args: unknown, callId: string) => Promise<unknown>
  onActivity?: (activity: AgentLoopActivity) => void
  onProgress?: (messages: readonly ChatMessage[]) => void
}): Promise<'retry' | 'unreliable' | 'ok'> {
  const correctionExists = input.messages.some(
    (message) => message.role === 'system' &&
      message.content.includes('本回合 chat 请求已经真实附上图片输入'),
  )
  const latestUser = [...input.messages].reverse().find((message) => message.role === 'user')?.content ?? ''
  if (input.hasImageInputs && !requestsExplicitVisualReview(latestUser) && deniesVisualCapability(input.text)) {
    if (correctionExists) return 'unreliable'
    input.messages.push({
      role: 'system',
      content:
        '本回合 chat 请求已经真实附上图片输入。描述 / 识别图片是你的主对话任务，' +
        '不得改用 visualReview，也不得按渠道名称或模型自述否认；请直接根据图片回答，看不清再说明具体限制。',
      createdAt: Date.now(),
    })
    input.onProgress?.(input.messages)
    return 'retry'
  }
  if (!visualEvidenceToCheck(input.messages, input.text, input.tools)) {
    return 'ok'
  }
  const nodeIds = [
    ...new Set(
      [...input.messages]
        .reverse()
        .find((message) => message.role === 'user')?.imageNodeIds ?? [],
    ),
  ]
  if (nodeIds.length === 0) return 'ok'
  const callId = `visual-evidence-${input.step}`
  input.messages.push({
    role: 'assistant',
    content: '',
    toolCalls: [{ id: callId, name: 'visualReview', args: JSON.stringify({ nodeIds }) }],
    createdAt: Date.now(),
  })
  input.onActivity?.({ id: callId, phase: 'tool', status: 'running', tool: 'visualReview' })
  let result: unknown
  try {
    result = await input.executeRead('visualReview', { nodeIds }, callId)
  } catch (error) {
    result = { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
  input.onActivity?.({
    id: callId,
    phase: 'tool',
    status: toolResultFailed(result) ? 'failed' : 'done',
    tool: 'visualReview',
  })
  input.messages.push({
    role: 'tool',
    toolCallId: callId,
    toolName: 'visualReview',
    content: JSON.stringify(result ?? {}),
    createdAt: Date.now(),
  })
  input.messages.push({
    role: 'system',
    content:
      '执行层已经调用 visualReview 读取本次真实图片。以上是工具结果，不是模型自述；' +
      '只能按结果报告看到的内容、未附图片或失败原因，不得继续把“纯文本模型”当作未经验证的结论。',
    createdAt: Date.now(),
  })
  input.onProgress?.(input.messages)
  return 'retry'
}
