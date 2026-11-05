import { useCallback, useMemo, useRef, useState } from 'react'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import type { ChatMessage } from '../../../../domain/shared/execution/types'
import { useGraph } from '../../storeContext'
import type { AgentPanelStatus } from './AgentActivityViews'
import {
  buildAssetHashByNode,
  buildConversationItems,
  buildNodeTitles,
  currentTurnHasProcessOf,
  latestProcessIndexOf,
  latestUserStartedAtOf,
  nodeLabelOf as conversationNodeLabelOf,
} from './agentConversationItems'
import {
  useAgentConversationController,
  type AgentMessageReveal,
} from './useAgentConversationController'

export interface AgentPanelSessionPresentationInput {
  current: AgentSession | null
  messages: readonly ChatMessage[]
  status: AgentPanelStatus
  composerHeight: number
}

export function useAgentPanelSessionPresentation({
  current,
  messages,
  status,
  composerHeight,
}: AgentPanelSessionPresentationInput) {
  const graph = useGraph()
  const nodeTitles = useMemo(() => buildNodeTitles(graph), [graph.nodes])
  const items = useMemo(
    () =>
      buildConversationItems({
        messages,
        pendingSteers: current?.pendingSteers ?? [],
        nodeTitles,
      }),
    [current?.pendingSteers, messages, nodeTitles],
  )
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const conversationViewportRef = useRef<{
    clientHeight: number
    scrollHeight: number
    scrollTop: number
  } | null>(null)
  const {
    beginReveal,
    clearReveal,
    expanded,
    toggleStep,
    showJumpToLatest,
    setShowJumpToLatest,
    stickToLatestRef,
    onConversationScroll,
    jumpToLatest,
    resetForSessionSwitch,
    streamingTextIndex,
    visibleItems,
  } = useAgentConversationController({
    items,
    sessionId: current?.id ?? null,
    messages,
    status,
    taskPlan: current?.taskPlan,
    queuedCount: current?.queuedTurns.length ?? 0,
    pendingCount: current?.pendingSteers.length ?? 0,
    composerHeight,
    scrollRef,
    conversationViewportRef,
  })
  const setMessageReveal = useCallback(
    (reveal: AgentMessageReveal | null) => {
      if (reveal) {
        beginReveal(
          reveal.sessionId,
          reveal.fullText,
          reveal.visibleLength,
        )
      } else {
        clearReveal()
      }
    },
    [beginReveal, clearReveal],
  )
  const [copiedKey, setCopiedKey] = useState<number | null>(null)
  /** 复制一条助手回复；剪贴板被拒时静默，不弹用户看不懂的错误。 */
  const copyReply = useCallback(async (key: number, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedKey(key)
      window.setTimeout(() => setCopiedKey((value) => (value === key ? null : value)), 1500)
    } catch {
      /* 无权限 / 非安全上下文：静默 */
    }
  }, [])
  const nodeLabelOf = useCallback(
    (id: string) => conversationNodeLabelOf(graph.nodes, id),
    [graph.nodes],
  )
  const latestUserStartedAt = latestUserStartedAtOf(visibleItems)
  const latestProcessIndex = latestProcessIndexOf(visibleItems)
  const currentTurnHasProcess = currentTurnHasProcessOf(visibleItems)
  const hashOfNode = useMemo(() => buildAssetHashByNode(graph), [graph])

  return {
    graph,
    items,
    scrollRef,
    conversationViewportRef,
    expanded,
    toggleStep,
    showJumpToLatest,
    setShowJumpToLatest,
    stickToLatestRef,
    clearReveal,
    onConversationScroll,
    jumpToLatest,
    resetForSessionSwitch,
    streamingTextIndex,
    visibleItems,
    setMessageReveal,
    copiedKey,
    copyReply,
    nodeLabelOf,
    latestUserStartedAt,
    latestProcessIndex,
    currentTurnHasProcess,
    hashOfNode,
  }
}
