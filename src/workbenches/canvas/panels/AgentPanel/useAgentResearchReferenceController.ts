import { useCallback, type MutableRefObject } from 'react'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import type { ReferenceItem } from '../../../../domain/project/referenceLedger'
import type { PlatformKit } from '../../../../platform/ports'
import type { NoticeTone } from '../../../../domain/ui/notice'
import { safeFilePrefix } from '../../../../features/shared/assets/downloadAsset'
import {
  addResearchCandidateToProject,
  throwIfResearchAborted,
  type AddResearchReferenceResult,
} from './agentResearchReference'
import type { ConversationResearchItem } from './conversation'
import { mentionToken } from '../../text/MentionEditor'
import { addResearchSourceReferenceToProject } from './researchSourceReference'
import { raceWithResearchAbort, runResearchAction } from './researchActionAbort'
import { downloadResearchImageBytes } from './researchImageDownload'

export { RESEARCH_IMAGE_SAVE_TIMEOUT_MS } from './researchActionAbort'
export interface ResearchActionResult { ok: boolean; message: string }
export interface ResearchSelectionCommit {
  committed: { candidate: ConversationResearchItem; reference: ReferenceItem }[]
  failed: { candidate: ConversationResearchItem; message: string }[]
  /** 按勾选顺序的 `@[标题](reference:id)`，追加到用户消息末尾。 */
  mentions: string[]
}

export function useAgentResearchReferenceController(input: {
  platform: PlatformKit
  projectId: string
  current: AgentSession | null
  currentIdRef: MutableRefObject<string | null>
  appendReferenceIds: (sessionId: string, ids: readonly string[]) => Promise<AgentSession | null>
  applySessionSnapshot: (session: AgentSession) => void
  notify: (message: string, tone?: NoticeTone) => void
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
    // URL 已在调研层校验；取不到扩展名时用 jpg 兜底（只给 saveFromUrl 退路用，直取字节按实际格式命名）
    const extension = /\.([a-zA-Z0-9]{2,5})$/.exec(URL.canParse(candidate.imageUrl)
      ? new URL(candidate.imageUrl).pathname : '')?.[1]?.toLowerCase() ?? 'jpg'
    return runResearchAction(parent, '下载失败', input.notify, async (signal) => {
      const direct = await raceWithResearchAbort(downloadResearchImageBytes(input.platform,
        candidate.imageUrl, safeFilePrefix(candidate.title || '轻画调研图片'), signal), signal)
      if (direct) return { ok: true, message: '图片已保存' }
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
  }, [input.notify, input.platform])

  /**
   * G-R2 / G-R4：发送带勾选图片的消息时才调用 —— 逐张存进参考台账并挂到会话
   * （图片存不下来时退回来源文字参考），返回要追加到消息末尾的 reference 引用。
   * 勾选阶段不写台账、不分析；分析由回合准备阶段的参考审阅（G5/G8）负责。
   * 每张图各有 12 秒总时限；失败的图不阻断其他图和这条消息，只汇总一条提示。
   */
  const commitSelection = useCallback(async (
    candidates: readonly ConversationResearchItem[],
    parent?: AbortSignal,
  ): Promise<ResearchSelectionCommit> => {
    const committed: ResearchSelectionCommit['committed'] = []
    const failed: ResearchSelectionCommit['failed'] = []
    for (const candidate of candidates) {
      if (parent?.aborted) break
      const result = await runResearchAction(parent, '参考图片保存失败', () => {},
        (signal) => saveAndAttach(candidate, signal, true))
      const item = 'item' in result ? result.item : undefined
      if (result.ok && item) committed.push({ candidate, reference: item })
      else failed.push({ candidate, message: result.message })
    }
    if (failed.length > 0 && !parent?.aborted) {
      input.notify(
        `${failed.length} 张参考图片没能加入：${failed[0]!.message}`,
        'error',
      )
    }
    return {
      committed,
      failed,
      mentions: committed.map(({ reference }) =>
        mentionToken('reference', reference.id, reference.title || '参考图片')),
    }
  }, [input.notify, saveAndAttach])

  return {
    addResearchReference: addReference,
    downloadResearchImage: downloadImage,
    commitResearchSelection: commitSelection,
  }
}
