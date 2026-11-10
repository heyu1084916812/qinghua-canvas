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
  if (normalized === 'pinterest') return 'pinterest'
  if (normalized === 'behance') return 'behance'
  if (normalized === 'google') return 'google'
  if (normalized === 'openverse') return 'openverse'
  if (normalized === 'wikipedia') return 'wikipedia'
  return 'web'
}

function referenceSourceOf(provider: ResearchProvider): ReferenceSource {
  if (provider === 'pinterest') return 'pinterest'
  if (provider === 'behance') return 'webFetch'
  return 'search'
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
    source: referenceSourceOf(researchItem.source),
    kind: saved?.asset ? 'image' : 'text',
    ...(saved?.asset ? { assetHash: saved.asset.hash } : {}),
    url: candidate.url,
    what: [
      candidate.description || candidate.title,
      candidate.credit ? `作者：${candidate.credit}` : '',
      candidate.license
        ? `许可：${candidate.license}${candidate.licenseUrl ? ` ${candidate.licenseUrl}` : ''}`
        : '',
      DESIGN_RESEARCH_RIGHTS_NOTE,
    ].filter(Boolean).join('\n'),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  await repository.putItem(item)
  return {
    ok: true,
    message: '已加入项目参考，并挂到当前 Agent 会话',
    item,
    ...(saved?.asset ? { asset: saved.asset } : {}),
  }
}
