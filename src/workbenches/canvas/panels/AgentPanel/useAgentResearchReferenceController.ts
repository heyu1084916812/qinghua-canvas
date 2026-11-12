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
import { addResearchSourceReferenceToProject } from './researchSourceReference'
import {
  raceWithResearchAbort,
  researchActionFailure,
  researchActionSignal,
} from './researchActionAbort'

export { RESEARCH_IMAGE_SAVE_TIMEOUT_MS } from './researchActionAbort'
export interface ResearchActionResult { ok: boolean; message: string }

export function useAgentResearchReferenceController(input: {
  platform: PlatformKit
  projectId: string
  current: AgentSession | null
  currentIdRef: MutableRefObject<string | null>
  appendReferenceIds: (sessionId: string, ids: readonly string[]) => Promise<AgentSession | null>
  applySessionSnapshot: (session: AgentSession) => void
  notify: (message: string, tone?: NoticeTone) => void
  insertMention: AgentAttachmentsControllerInput['insertMention']
}) {
  const saveAndAttach = useCallback(async (
    candidate: ConversationResearchItem,
    signal: AbortSignal,
    allowSourceFallback: boolean,
  ): Promise<AddResearchReferenceResult> => {
    const sessionId = input.current?.id
    if (!sessionId) return { ok: false, message: '当前没有可用的 Agent 会话' }
    let result = await raceWithResearchAbort(addResearchCandidateToProject(candidate, {
      platform: input.platform,
      projectId: input.projectId,
      signal,
    }), signal)
    if ((!result.ok || !result.item) && allowSourceFallback) {
      const fallback = await raceWithResearchAbort(addResearchSourceReferenceToProject(candidate, {
        platform: input.platform,
        projectId: input.projectId,
      }), signal)
      if (!fallback.ok || !fallback.item) {
        return { ok: false, message: fallback.message || result.message }
      }
      result = fallback
    }
    if (!result.ok || !result.item) return result
    const snapshot = await raceWithResearchAbort(
      input.appendReferenceIds(sessionId, [result.item.id]),
      signal,
    )
    if (!snapshot) return { ...result, ok: false, message: '参考已保存，但挂到当前会话失败' }
    if (input.currentIdRef.current === sessionId) input.applySessionSnapshot(snapshot)
    return result
  }, [input.appendReferenceIds, input.applySessionSnapshot, input.current, input.currentIdRef,
    input.platform, input.projectId])

  const addReference = useCallback(async (
    candidate: ConversationResearchItem,
    parent?: AbortSignal,
  ): Promise<AddResearchReferenceResult> => {
    const result = researchActionSignal(parent)
    try {
      const saved = await saveAndAttach(candidate, result.signal, false)
      if (!parent?.aborted) input.notify(saved.message, saved.ok ? 'info' : 'error')
      return saved
    } catch (error) {
      const message = researchActionFailure(result, parent, error, '加入项目参考失败')
      if (!parent?.aborted) input.notify(message, 'error')
      return { ok: false, message }
    }
  }, [input.notify, saveAndAttach])

  const downloadImage = useCallback(async (
    candidate: ConversationResearchItem,
    parent?: AbortSignal,
  ): Promise<ResearchActionResult> => {
    if (!candidate.imageUrl) return { ok: false, message: '这条结果没有可下载的图片' }
    let extension = 'jpg'
    try {
      extension = /\.([a-zA-Z0-9]{2,5})$/.exec(new URL(candidate.imageUrl).pathname)?.[1]
        ?.toLowerCase() ?? extension
    } catch {
      /* URL 已在调研层校验；取不到扩展名时使用 jpg 兜底 */
    }
    const result = researchActionSignal(parent)
    try {
      const via = await raceWithResearchAbort(input.platform.files.saveFromUrl(
        candidate.imageUrl,
        `${safeFilePrefix(candidate.title || '轻画调研图片')}.${extension}`,
      ), result.signal)
      const message = via === 'saved'
        ? '图片已保存'
        : '浏览器不允许直接读取图片，已在新标签页打开'
      if (!parent?.aborted) input.notify(message, 'info')
      return { ok: true, message }
    } catch (error) {
      const message = researchActionFailure(result, parent, error, '下载失败')
      if (!parent?.aborted) input.notify(message, 'error')
      return { ok: false, message }
    }
  }, [input.notify, input.platform.files])

  const sendToChat = useCallback(async (
    candidate: ConversationResearchItem,
    parent?: AbortSignal,
  ): Promise<ResearchActionResult> => {
    const result = researchActionSignal(parent)
    try {
      const saved = await saveAndAttach(candidate, result.signal, true)
      if (!saved.ok || !saved.item) {
        if (!parent?.aborted) input.notify(saved.message, 'error')
        return saved
      }
      input.insertMention('reference', saved.item.id, saved.item.title)
      const message = saved.item.kind === 'image'
        ? '已把图片引用放入当前对话'
        : saved.message
      if (!parent?.aborted) input.notify(message, 'info')
      return { ok: true, message }
    } catch (error) {
      const message = researchActionFailure(result, parent, error, '发送到对话失败')
      if (!parent?.aborted) input.notify(message, 'error')
      return { ok: false, message }
    }
  }, [input.insertMention, input.notify, saveAndAttach])

  return {
    addResearchReference: addReference,
    downloadResearchImage: downloadImage,
    sendResearchToChat: sendToChat,
  }
}
