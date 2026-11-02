import type {
  ChatMessage,
} from '../../../../domain/shared/execution/types'
import { AGENT_CONTEXT_WINDOW } from '../../../../state/agent/sessionStore'
import type { AgentSession, AgentSessionStore } from '../../../../state/agent/sessionStore'
import { trimOrphanToolMessages } from '../../agent/historyWindow'

export interface AgentUserTurnInput {
  content: string
  display: string
  imageNodeIds: readonly string[]
  contextWindow?: number
  internalControl?: boolean
  now?: number
}

export interface PersistAgentUserTurnInput extends AgentUserTurnInput {
  history: readonly ChatMessage[]
}

export interface PersistedAgentUserTurn {
  /** 经窗口裁剪与 orphan tool 清理后，真正发送给模型的旧历史。 */
  modelWindow: ChatMessage[]
  userMessage: ChatMessage
  /** 全量历史加本次用户消息；界面、落库和后续合并都以它为真相。 */
  historyMessages: ChatMessage[]
  /**
   * `outcome.messages` 中“本次新增消息”的起始下标。
   *
   * 模型输入固定是 `system + modelWindow + userMessage`，因此后续 assistant/tool
   * 结果从这个下标开始，与被裁剪的历史无关。
   */
  outcomeTailIndex: number
  saved: AgentSession
}

/**
 * 在第一次模型请求前持久化用户回合。
 *
 * 模型窗口可以裁剪，但 `historyMessages` 始终保留完整历史。这样窗口边界上的
 * orphan tool 或前缀消息不会因为一次请求而从 UI / 数据库永久消失。
 */
export async function persistAgentUserTurnBeforeRequest(
  sessions: Pick<AgentSessionStore, 'saveMessages'>,
  sessionId: string,
  input: PersistAgentUserTurnInput,
): Promise<PersistedAgentUserTurn> {
  const fullHistory = input.history.filter((message) => message.role !== 'system')
  const previous = fullHistory.at(-1)
  /**
   * 路由失败 / 用户停止时，用户消息已经落库，但队列项按既有规则可能保留。
   * 再次继续同一条队列时，末尾会是同一条“尚未得到 assistant 回复”的用户消息；
   * 先替换而不是再追加，避免同一次请求在历史里出现两遍。
   */
  const history =
    previous?.role === 'user' &&
    previous.content === input.content &&
    previous.display === input.display &&
    (previous.hiddenFromConversation === true) === (input.internalControl === true) &&
    sameIds(previous.imageNodeIds ?? [], input.imageNodeIds)
      ? fullHistory.slice(0, -1)
      : fullHistory
  const windowSize = input.contextWindow ?? AGENT_CONTEXT_WINDOW
  const cut = Math.max(0, history.length - windowSize)
  const modelWindow = trimOrphanToolMessages(history.slice(cut))
  const userMessage: ChatMessage = {
    role: 'user',
    content: input.content,
    display: input.display,
    createdAt: input.now ?? Date.now(),
    ...(input.internalControl ? { hiddenFromConversation: true } : {}),
    imageNodeIds: [...new Set(input.imageNodeIds)],
  }
  const historyMessages = [...history, userMessage]
  const saved = await sessions.saveMessages(sessionId, historyMessages)
  if (!saved) {
    throw new Error('用户消息没有写入目标会话')
  }
  return {
    modelWindow,
    userMessage,
    historyMessages,
    outcomeTailIndex: 1 + modelWindow.length + 1,
    saved,
  }
}

/** 只从目标会话读历史，绝不使用界面上另一个会话的消息。 */
export async function persistAgentUserTurnForSession(
  sessions: Pick<AgentSessionStore, 'messagesFor' | 'saveMessages'>,
  sessionId: string,
  input: AgentUserTurnInput,
): Promise<PersistedAgentUserTurn> {
  const history = await sessions.messagesFor(sessionId)
  return persistAgentUserTurnBeforeRequest(sessions, sessionId, {
    ...input,
    history,
  })
}

/**
 * 强制“先持久化用户消息，再准备路由”。
 *
 * `onPersisted` 在路由准备前触发，供界面立即显示用户消息；即使路由返回失败或抛错，
 * 消息也已经写入目标会话，且不会提前创建 AgentJob。
 */
export async function persistAgentUserTurnBeforeRoute<Route>(
  sessions: Pick<AgentSessionStore, 'messagesFor' | 'saveMessages'>,
  sessionId: string,
  input: AgentUserTurnInput,
  prepareRoute: () => Promise<Route>,
  onPersisted?: (turn: PersistedAgentUserTurn) => void,
): Promise<{ turn: PersistedAgentUserTurn; route: Route }> {
  const turn = await persistAgentUserTurnForSession(
    sessions,
    sessionId,
    input,
  )
  onPersisted?.(turn)
  const route = await prepareRoute()
  return { turn, route }
}

export function buildAgentModelMessages(
  system: string,
  turn: PersistedAgentUserTurn,
): ChatMessage[] {
  return [
    { role: 'system', content: system },
    ...turn.modelWindow,
    turn.userMessage,
  ]
}

/**
 * 用完整历史替换模型窗口，只追加本次请求之后产生的消息。
 *
 * 不能只把“窗口外前缀”拼回去：`trimOrphanToolMessages()` 还可能删掉窗口开端
 * 的 orphan tool，那些消息同样必须保留。
 */
export function composeAgentOutcomeMessages(
  turn: PersistedAgentUserTurn,
  outcomeMessages: readonly ChatMessage[],
): ChatMessage[] {
  return [
    ...turn.historyMessages,
    ...outcomeMessages.slice(turn.outcomeTailIndex),
  ]
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  const a = [...new Set(left)].sort()
  const b = [...new Set(right)].sort()
  return a.length === b.length && a.every((id, index) => id === b[index])
}
