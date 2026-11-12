import { useCallback, type MutableRefObject } from 'react'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import type { PlatformKit } from '../../../../platform/ports'
import type { NoticeTone } from '../../../../domain/ui/notice'
import { safeFilePrefix } from '../../../../features/shared/assets/downloadAsset'
import {
  addResearchCandidateToProject,
  type AddResearchReferenceResult,
} from './agentResearchReference'
import type { ConversationResearchItem } from './conversation'
import type { AgentAttachmentsControllerInput } from './useAgentAttachmentsController'

export interface ResearchActionResult {
  ok: boolean
  message: string
}

export function useAgentResearchReferenceController(input: {
  platform: PlatformKit
  projectId: string
  current: AgentSession | null
  currentIdRef: MutableRefObject<string | null>
  appendReferenceIds: (
    sessionId: string,
    ids: readonly string[],
  ) => Promise<AgentSession | null>
  applySessionSnapshot: (session: AgentSession) => void
  notify: (message: string, tone?: NoticeTone) => void
  insertMention: AgentAttachmentsControllerInput['insertMention']
}) {
  const addReference = useCallback(
    async (
      candidate: ConversationResearchItem,
    ): Promise<AddResearchReferenceResult> => {
      const sessionId = input.current?.id
      if (!sessionId) {
        const failed = { ok: false, message: '当前没有可用的 Agent 会话' }
        input.notify(failed.message, 'error')
        return failed
      }
      const result = await addResearchCandidateToProject(candidate, {
        platform: input.platform,
        projectId: input.projectId,
        signal: new AbortController().signal,
      })
      if (!result.ok || !result.item) {
        input.notify(result.message, 'error')
        return result
      }
      try {
        const snapshot = await input.appendReferenceIds(sessionId, [result.item.id])
        if (snapshot && input.currentIdRef.current === sessionId) {
          input.applySessionSnapshot(snapshot)
        }
        input.notify(result.message, 'info')
        return result
      } catch (error) {
        const message =
          error instanceof Error ? error.message : '参考已保存，但挂到当前会话失败'
        input.notify(message, 'error')
        return { ...result, ok: false, message }
      }
    },
    [
      input.appendReferenceIds,
      input.applySessionSnapshot,
      input.current,
      input.currentIdRef,
      input.notify,
      input.platform,
      input.projectId,
    ],
  )

  const downloadImage = useCallback(
    async (candidate: ConversationResearchItem): Promise<ResearchActionResult> => {
      if (!candidate.imageUrl) {
        return { ok: false, message: '这条结果没有可下载的图片' }
      }
      let extension = 'jpg'
      try {
        const match = /\.([a-zA-Z0-9]{2,5})$/.exec(
          new URL(candidate.imageUrl).pathname,
        )
        if (match?.[1]) extension = match[1].toLowerCase()
      } catch {
        /* URL 已在调研层校验；取不到扩展名时使用 jpg 兜底 */
      }
      try {
        const via = await input.platform.files.saveFromUrl(
          candidate.imageUrl,
          `${safeFilePrefix(candidate.title || '轻画调研图片')}.${extension}`,
        )
        const message =
          via === 'saved'
            ? '图片已保存'
            : '浏览器不允许直接读取图片，已在新标签页打开'
        input.notify(message, 'info')
        return { ok: true, message }
      } catch (error) {
        const message =
          error instanceof Error ? `下载失败：${error.message}` : '下载失败'
        input.notify(message, 'error')
        return { ok: false, message }
      }
    },
    [input.notify, input.platform.files],
  )

  const sendToChat = useCallback(
    async (candidate: ConversationResearchItem): Promise<ResearchActionResult> => {
      const result = await addReference(candidate)
      if (!result.ok || !result.item) return result
      input.insertMention('reference', result.item.id, result.item.title)
      return { ok: true, message: '已把图片引用放入当前对话' }
    },
    [addReference, input.insertMention],
  )

  return {
    addResearchReference: addReference,
    downloadResearchImage: downloadImage,
    sendResearchToChat: sendToChat,
  }
}
