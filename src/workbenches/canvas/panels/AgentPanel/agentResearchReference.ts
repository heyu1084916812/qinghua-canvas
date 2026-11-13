import type { DesignResearchItem, ResearchProvider } from '../../../../domain/inspiration/designResearch'
import { DESIGN_RESEARCH_RIGHTS_NOTE } from '../../../../domain/inspiration/designResearch'
import type { ReferenceItem, ReferenceSource } from '../../../../domain/project/referenceLedger'
import type { LibraryAsset } from '../../../../domain/shared/assetLibrary'
import { saveDesignResearchItem } from '../../../../features/shared/research/saveResearchItem'
import type { PlatformKit } from '../../../../platform/ports'
import { createReferenceLedgerRepository } from '../../../../state/project/referenceLedgerRepository'
import type { ConversationResearchItem } from './conversation'

export interface AddResearchReferenceResult {
  ok: boolean
  message: string
  item?: ReferenceItem
  asset?: LibraryAsset
}

function providerOf(source: string): ResearchProvider {
  const normalized = source.trim().toLowerCase()
  const same = ['pinterest', 'behance', 'google', 'openverse', 'wikipedia', 'dribbble', 'thedieline', 'packagingoftheworld'] as const // 名字即 id（含 #1087 浏览器站点）
  const hit = same.find((id) => id === normalized)
  if (hit) return hit
  if (normalized === 'internet archive' || normalized === 'internetarchive') {
    return 'internetArchive'
  }
  if (normalized === 'art institute' || normalized === 'artic') return 'artic'
  if (normalized === 'cleveland' || normalized === 'cleveland museum') return 'cleveland'
  if (normalized === 'met' || normalized === 'met museum') return 'met'
  if (normalized === 'searxng') return 'searxng'
  if (normalized === 'tavily') return 'tavily'
  if (normalized === 'bing') return 'bing'
  if (normalized === 'huaban' || normalized === '花瓣') return 'huaban'
  if (normalized === 'zcool' || normalized === '站酷') return 'zcool'
  if (normalized === 'the dieline' || normalized === 'dieline') return 'thedieline'
  if (normalized === 'packaging of the world') return 'packagingoftheworld'
  return 'web'
}

export function researchReferenceSourceOf(provider: ResearchProvider): ReferenceSource {
  if (provider === 'pinterest') return 'pinterest'
  if (provider === 'behance') return 'webFetch'
  return 'search'
}

export function researchReferenceWhatOf(candidate: ConversationResearchItem): string {
  return [
    candidate.description || candidate.title,
    `来源页面：${candidate.url}`,
    candidate.imageUrl ? `图片地址：${candidate.imageUrl}` : '',
    candidate.credit ? `作者：${candidate.credit}` : '',
    candidate.license
      ? `许可：${candidate.license}${candidate.licenseUrl ? ` ${candidate.licenseUrl}` : ''}`
      : '',
    DESIGN_RESEARCH_RIGHTS_NOTE,
  ].filter(Boolean).join('\n')
}

export function researchItemOf(candidate: ConversationResearchItem): DesignResearchItem {
  return {
    id: candidate.id,
    source: providerOf(candidate.source),
    title: candidate.title,
    url: candidate.url,
    imageUrl: candidate.imageUrl,
    ...(candidate.description ? { description: candidate.description } : {}),
    ...(candidate.credit ? { credit: candidate.credit } : {}),
    ...(candidate.license ? { license: candidate.license } : {}),
    ...(candidate.licenseUrl ? { licenseUrl: candidate.licenseUrl } : {}),
  }
}

/** 取消后抛 AbortError，调用方据此报「已取消 / 超时」而不是写入。 */
export function throwIfResearchAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException('已取消', 'AbortError')
}

export async function addResearchCandidateToProject(
  candidate: ConversationResearchItem,
  input: {
    platform: PlatformKit
    projectId: string
    signal: AbortSignal
  },
): Promise<AddResearchReferenceResult> {
  const researchItem = researchItemOf(candidate)
  const repository = createReferenceLedgerRepository(input.platform.storage)
  const existingItems = await repository.listItems(input.projectId)
  const saved = candidate.imageUrl
    ? await saveDesignResearchItem(
        researchItem,
        {
          network: input.platform.network,
          storage: input.platform.storage,
        },
        input.signal,
      )
    : null
  if (saved && (!saved.ok || !saved.asset)) return saved
  // B6：取消 / 超时后不再写台账（图片字节可能已入素材库，但不生成参考卡）。
  throwIfResearchAborted(input.signal)
  const existing = existingItems.find((item) =>
    saved?.asset
      ? item.assetHash === saved.asset.hash
      : item.url === candidate.url,
  )
  const now = Date.now()
  const item: ReferenceItem = {
    id:
      existing?.id ??
      (saved?.asset
        ? `ref_search_${saved.asset.hash}`
        : `ref_search_text_${candidate.id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80)}`),
    projectId: input.projectId,
    title: candidate.title.trim() || '联网调研参考',
    source: researchReferenceSourceOf(researchItem.source),
    kind: saved?.asset ? 'image' : 'text',
    ...(saved?.asset ? { assetHash: saved.asset.hash } : {}),
    url: candidate.url,
    what: researchReferenceWhatOf(candidate),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  throwIfResearchAborted(input.signal)
  await repository.putItem(item)
  return {
    ok: true,
    message: '已加入项目参考，并挂到当前 Agent 会话',
    item,
    ...(saved?.asset ? { asset: saved.asset } : {}),
  }
}
