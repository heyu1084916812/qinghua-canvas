import { useCallback, type MutableRefObject } from 'react'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import type { PlatformKit } from '../../../../platform/ports'
import type { NoticeTone } from '../../../../domain/ui/notice'
import { safeFilePrefix } from '../../../../features/shared/assets/downloadAsset'
import {
  addResearchCandidateToProject,
  throwIfResearchAborted,
  type AddResearchReferenceResult,
} from './agentResearchReference'
import type { ConversationResearchItem } from './conversation'
import type { AgentAttachmentsControllerInput } from './useAgentAttachmentsController'
import { addResearchSourceReferenceToProject } from './researchSourceReference'
import { raceWithResearchAbort, runResearchAction } from './researchActionAbort'

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
      throwIfResearchAborted(signal)
      const fallback = await raceWithResearchAbort(addResearchSourceReferenceToProject(candidate, {
        platform: input.platform,
        projectId: input.projectId,
        signal,
      }), signal)
      if (!fallback.ok || !fallback.item) {
        return { ok: false, message: fallback.message || result.message }
      }
      result = fallback
    }
    if (!result.ok || !result.item) return result
    // B6：挂会话前再查取消；本地写入一旦开始就等它落完（不 race），免得报「已取消」却已挂上。
    throwIfResearchAborted(signal)
    const snapshot = await input.appendReferenceIds(sessionId, [result.item.id])
    if (!snapshot) return { ...result, ok: false, message: '参考已保存，但挂到当前会话失败' }
    if (input.currentIdRef.current === sessionId) input.applySessionSnapshot(snapshot)
    return result
  }, [input.appendReferenceIds, input.applySessionSnapshot, input.current, input.currentIdRef,
    input.platform, input.projectId])

  const addReference = useCallback((
    candidate: ConversationResearchItem,
    parent?: AbortSignal,
  ): Promise<AddResearchReferenceResult> => runResearchAction(parent, '加入项目参考失败', input.notify,
    (signal) => saveAndAttach(candidate, signal, false)), [input.notify, saveAndAttach])

  const downloadImage = useCallback((
    candidate: ConversationResearchItem,
    parent?: AbortSignal,
  ): Promise<ResearchActionResult> => {
    if (!candidate.imageUrl) return Promise.resolve({ ok: false, message: '这条结果没有可下载的图片' })
    let extension = 'jpg'
    try {
      extension = /\.([a-zA-Z0-9]{2,5})$/.exec(new URL(candidate.imageUrl).pathname)?.[1]
        ?.toLowerCase() ?? extension
    } catch {
      /* URL 已在调研层校验；取不到扩展名时使用 jpg 兜底 */
    }
    return runResearchAction(parent, '下载失败', input.notify, async (signal) => {
      const via = await raceWithResearchAbort(input.platform.files.saveFromUrl(
        candidate.imageUrl,
        `${safeFilePrefix(candidate.title || '轻画调研图片')}.${extension}`,
        signal,
      ), signal)
      return {
        ok: true,
        message: via === 'saved' ? '图片已保存' : '浏览器不允许直接读取图片，已在新标签页打开',
      }
    })
  }, [input.notify, input.platform.files])

  const sendToChat = useCallback((
    candidate: ConversationResearchItem,
    parent?: AbortSignal,
  ): Promise<ResearchActionResult> => runResearchAction(parent, '发送到对话失败', input.notify,
    async (signal) => {
      const saved = await saveAndAttach(candidate, signal, true)
      if (!saved.ok || !saved.item) return { ok: false, message: saved.message }
      input.insertMention('reference', saved.item.id, saved.item.title)
      return {
        ok: true,
        message: saved.item.kind === 'image' ? '已把图片引用放入当前对话' : saved.message,
      }
    }), [input.insertMention, input.notify, saveAndAttach])

  return {
    addResearchReference: addReference,
    downloadResearchImage: downloadImage,
    sendResearchToChat: sendToChat,
  }
}
