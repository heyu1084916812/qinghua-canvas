import type { ReferenceItem } from '../../../../domain/project/referenceLedger'
import { isPublicHttpUrl } from '../../../../domain/shared/publicUrl'
import type { PlatformKit } from '../../../../platform/ports'
import { createReferenceLedgerRepository } from '../../../../state/project/referenceLedgerRepository'
import {
  researchItemOf,
  researchReferenceWhatOf,
  researchReferenceSourceOf,
  throwIfResearchAborted,
  type AddResearchReferenceResult,
} from './agentResearchReference'
import type { ConversationResearchItem } from './conversation'

/**
 * 对话发送的降级路径：图片字节拿不到时仍把稳定的来源上下文写入台账。
 * 这不是“图片保存成功”，所以卡片保持 text，不伪造 assetHash。
 */
export async function addResearchSourceReferenceToProject(
  candidate: ConversationResearchItem,
  input: { platform: PlatformKit; projectId: string; signal?: AbortSignal },
): Promise<AddResearchReferenceResult> {
  if (!isPublicHttpUrl(candidate.url)) {
    return { ok: false, message: '来源不是公开互联网地址，已拒绝发送' }
  }
  const repository = createReferenceLedgerRepository(input.platform.storage)
  const existing = (await repository.listItems(input.projectId))
    .find((item) => item.url === candidate.url)
  if (existing) {
    return {
      ok: true,
      message: existing.kind === 'image'
        ? '已把图片引用放入当前对话'
        : '图片未能保存，已把来源信息发送到对话',
      item: existing,
    }
  }
  const now = Date.now()
  const researchItem = researchItemOf(candidate)
  const item: ReferenceItem = {
    id: `ref_search_source_${candidate.id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80)}`,
    projectId: input.projectId,
    title: candidate.title.trim() || '联网调研参考',
    source: researchReferenceSourceOf(researchItem.source),
    kind: 'text',
    url: candidate.url,
    what: researchReferenceWhatOf(candidate),
    createdAt: now,
    updatedAt: now,
  }
  throwIfResearchAborted(input.signal)
  await repository.putItem(item)
  return {
    ok: true,
    message: '图片未能保存，已把来源信息发送到对话',
    item,
  }
}
