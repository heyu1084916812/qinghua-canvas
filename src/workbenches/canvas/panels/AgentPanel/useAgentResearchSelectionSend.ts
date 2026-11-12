import { useCallback, useRef } from 'react'
import type { AgentDeliveryMode } from '../../../../domain/agent/delivery'
import type { ConversationResearchItem } from './conversation'
import {
  composeResearchSelectionText,
  researchSelectionActions,
  researchSelectionStore,
} from './researchSelection'
import type { ResearchSelectionCommit } from './useAgentResearchReferenceController'

/**
 * 输入框发送（G-R2 / G-R4）：输入框上挂着调研勾选的图片时，先把它们存进参考台账、
 * 挂到会话，再作为 reference 引用追加到正文末尾，按原有「直发 / 排队 / 引导」路径发出；
 * 回合准备阶段的参考审阅据此分析用法（拿不准分工就发问题卡）。
 * 勾选阶段从不写台账、不分析。没有勾选时与原来完全一样。
 */
export function useAgentResearchSelectionSend(input: {
  sessionId: string
  draft: string
  deliveryMode: AgentDeliveryMode
  commitResearchSelection: (
    items: readonly ConversationResearchItem[],
  ) => Promise<ResearchSelectionCommit>
  dispatchText: (text: string, mode: AgentDeliveryMode) => void
  runPromiseDetached: (promise: Promise<unknown>, label: string) => void
}) {
  const committingRef = useRef(false)
  const { sessionId, draft, deliveryMode, commitResearchSelection, dispatchText, runPromiseDetached } = input
  return useCallback(
    (requestedMode: AgentDeliveryMode = deliveryMode) => {
      const staged = researchSelectionStore.get(sessionId).selected
      if (staged.length === 0) {
        dispatchText(draft, requestedMode)
        return
      }
      // 存台账期间再点发送不重复提交。
      if (committingRef.current) return
      committingRef.current = true
      const text = draft
      runPromiseDetached((async () => {
        try {
          const commit = await commitResearchSelection(staged)
          researchSelectionActions(sessionId).markSent(
            commit.committed.map((row) => row.candidate),
          )
          dispatchText(composeResearchSelectionText(text, commit.mentions), requestedMode)
        } finally {
          committingRef.current = false
        }
      })(), '发送失败')
    },
    [commitResearchSelection, deliveryMode, dispatchText, draft, runPromiseDetached, sessionId],
  )
}
