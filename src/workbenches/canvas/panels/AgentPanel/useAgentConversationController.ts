import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useRef,
  type MutableRefObject,
  type RefObject,
} from 'react'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import type { AgentPanelStatus } from './AgentActivityViews'
import type { ConversationItem } from './conversation'
import {
  agentScrollTopAfterShrink,
  agentShouldFollowLatest,
  agentShouldShowJumpLatest,
  type AgentScrollMetrics,
} from './agentConversationScroll'
import {
  AGENT_REVEAL_TICK_MS,
  agentRevealCharacters,
  nextAgentRevealLength,
} from './agentOutputReveal'

export interface AgentMessageReveal {
  sessionId: string
  fullText: string
  visibleLength: number
}

export interface AgentConversationControllerInput {
  items: readonly ConversationItem[]
  sessionId: string | null
  messages: readonly unknown[]
  status: AgentPanelStatus | null
  taskPlan: AgentSession['taskPlan'] | undefined
  queuedCount: number
  pendingCount: number
  composerHeight: number
  scrollRef: RefObject<HTMLDivElement | null>
  conversationViewportRef: MutableRefObject<AgentScrollMetrics | null>
}

export interface AgentConversationController {
  messageReveal: AgentMessageReveal | null
  beginReveal: (
    sessionId: string,
    fullText: string,
    visibleLength?: number,
  ) => void
  clearReveal: () => void
  expanded: ReadonlySet<string>
  toggleStep: (id: string) => void
  scrollRef: RefObject<HTMLDivElement | null>
  conversationViewportRef: MutableRefObject<AgentScrollMetrics | null>
  showJumpToLatest: boolean
  setShowJumpToLatest: (value: boolean) => void
  stickToLatestRef: MutableRefObject<boolean>
  onConversationScroll: () => void
  jumpToLatest: () => void
  resetForSessionSwitch: () => void
  streamingTextIndex: number
  visibleItems: readonly ConversationItem[]
}

/**
 * 会话展示控制：只管理 reveal / expand / 滚动跟随的本地视图状态。
 * 它不读会话、消息或队列真相，只接收当前渲染输入并返回派生结果。
 */
export function useAgentConversationController(
  input: AgentConversationControllerInput,
): AgentConversationController {
  const {
    items,
    sessionId,
    messages,
    status,
    taskPlan,
    queuedCount,
    pendingCount,
    composerHeight,
  } = input
  const [messageReveal, setMessageReveal] =
    useState<AgentMessageReveal | null>(null)
  const [showJumpToLatest, setShowJumpToLatest] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const stickToLatestRef = useRef(true)
  const scrollRef = input.scrollRef
  const conversationViewportRef = input.conversationViewportRef

  const beginReveal = useCallback((
    id: string,
    fullText: string,
    visibleLength = 1,
  ) => {
    setMessageReveal({
      sessionId: id,
      fullText,
      visibleLength,
    })
  }, [])

  const clearReveal = useCallback(() => {
    setMessageReveal(null)
  }, [])

  const resetForSessionSwitch = useCallback(() => {
    setMessageReveal(null)
    setShowJumpToLatest(false)
    stickToLatestRef.current = true
  }, [])

  const toggleStep = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  useEffect(() => {
    if (!messageReveal) return
    const characters = agentRevealCharacters(messageReveal.fullText)
    if (messageReveal.visibleLength >= characters.length) {
      setMessageReveal(null)
      return
    }
    const timer = window.setTimeout(() => {
      setMessageReveal((current) => {
        if (
          !current ||
          current.sessionId !== messageReveal.sessionId ||
          current.fullText !== messageReveal.fullText
        ) {
          return current
        }
        return {
          ...current,
          visibleLength: nextAgentRevealLength(
            current.visibleLength,
            characters.length,
          ),
        }
      })
    }, AGENT_REVEAL_TICK_MS)
    return () => window.clearTimeout(timer)
  }, [messageReveal])

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const previous = conversationViewportRef.current
    const wasFollowing = previous
      ? agentShouldFollowLatest(previous)
      : stickToLatestRef.current
    if (previous && previous.clientHeight > el.clientHeight) {
      el.scrollTop = agentScrollTopAfterShrink(previous, el.clientHeight)
    }
    if (wasFollowing) el.scrollTop = el.scrollHeight
    stickToLatestRef.current = agentShouldFollowLatest(el)
    setShowJumpToLatest(agentShouldShowJumpLatest(el))
    conversationViewportRef.current = {
      clientHeight: el.clientHeight,
      scrollHeight: el.scrollHeight,
      scrollTop: el.scrollTop,
    }
  }, [
    conversationViewportRef,
    messages,
    status,
    taskPlan,
    queuedCount,
    pendingCount,
    messageReveal?.visibleLength,
    composerHeight,
    scrollRef,
  ])

  const onConversationScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    stickToLatestRef.current = agentShouldFollowLatest(el)
    setShowJumpToLatest(agentShouldShowJumpLatest(el))
    conversationViewportRef.current = {
      clientHeight: el.clientHeight,
      scrollHeight: el.scrollHeight,
      scrollTop: el.scrollTop,
    }
  }, [conversationViewportRef, scrollRef])

  const jumpToLatest = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    stickToLatestRef.current = true
    setShowJumpToLatest(false)
    el.scrollTo({
      top: el.scrollHeight,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth',
    })
  }, [scrollRef])

  const streamingTextIndex = useMemo(() => {
    if (!messageReveal || messageReveal.sessionId !== sessionId) return -1
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const item = items[index]
      if (item?.kind === 'text' && item.text === messageReveal.fullText) {
        return index
      }
    }
    return -1
  }, [items, messageReveal, sessionId])

  const visibleItems = useMemo(() => {
    if (!messageReveal || streamingTextIndex < 0) return items
    const characters = agentRevealCharacters(messageReveal.fullText)
    const visibleText = characters
      .slice(0, messageReveal.visibleLength)
      .join('')
    return items.map((item, index) =>
      index === streamingTextIndex && item.kind === 'text'
        ? { ...item, text: visibleText }
        : item,
    )
  }, [items, messageReveal, streamingTextIndex])

  return {
    messageReveal,
    beginReveal,
    clearReveal,
    expanded,
    toggleStep,
    scrollRef,
    conversationViewportRef,
    showJumpToLatest,
    setShowJumpToLatest,
    stickToLatestRef,
    onConversationScroll,
    jumpToLatest,
    resetForSessionSwitch,
    streamingTextIndex,
    visibleItems,
  }
}
