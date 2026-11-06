import {
  cleanEcommerceDraftRefs,
  type EcommerceFormDraft,
} from '../../../domain/ecommerce/draft'
import type { AssetPayload } from '../../../platform/ports'
import {
  legacyAssetHashesOfNode,
  type LegacyGenerationNode,
} from '../ecommercePageSupport'

export const ECOMMERCE_DRAFT_AUTOSAVE_MS = 500

export interface EcommerceDraftUploadProjection {
  nodeId: string
  hash: string
  kind: 'node' | 'asset'
}

export interface EcommerceDraftRecoveryRepository {
  load(projectId: string): Promise<EcommerceFormDraft | null>
  nodes(projectId: string): Promise<readonly LegacyGenerationNode[]>
  save(projectId: string, draft: EcommerceFormDraft): Promise<unknown> | unknown
}

export interface EcommerceDraftRecoveryPorts {
  projectId: string
  repository: EcommerceDraftRecoveryRepository
  assets: {
    read(id: string): Promise<AssetPayload | null>
  }
  isCancelled?(): boolean
}

export interface EcommerceDraftRecoveryResult {
  draft: EcommerceFormDraft | null
  products: EcommerceDraftUploadProjection[]
  references: EcommerceDraftUploadProjection[]
}

function refsChanged(before: EcommerceFormDraft, after: EcommerceFormDraft): boolean {
  return (
    before.productNodeIds.join('|') !== after.productNodeIds.join('|') ||
    before.referenceNodeIds.join('|') !== after.referenceNodeIds.join('|')
  )
}

/** Restores nodes/assets in parallel; preview JSX stays in the React host. */
export async function restoreEcommercePageDraft(
  ports: EcommerceDraftRecoveryPorts,
): Promise<EcommerceDraftRecoveryResult | null> {
  const [draft, nodes] = await Promise.all([
    ports.repository.load(ports.projectId),
    ports.repository.nodes(ports.projectId),
  ])
  if (ports.isCancelled?.()) return null

  const byId = new Map(nodes.map((node) => [node.id, node]))
  const draftIds = [
    ...new Set([
      ...(draft?.productNodeIds ?? []),
      ...(draft?.referenceNodeIds ?? []),
    ]),
  ]
  const assetIds = new Set<string>()
  await Promise.all(
    draftIds.map(async (id) => {
      if (byId.has(id)) return
      if (await ports.assets.read(id)) assetIds.add(id)
    }),
  )
  if (ports.isCancelled?.()) return null

  const uploadOf = (id: string): EcommerceDraftUploadProjection | null => {
    const node = byId.get(id)
    if (node) {
      const hash = legacyAssetHashesOfNode(node)[0]
      return hash ? { nodeId: id, hash, kind: 'node' } : null
    }
    return assetIds.has(id) ? { nodeId: id, hash: id, kind: 'asset' } : null
  }
  const validNodeIds = new Set([
    ...nodes
      .filter((node) => legacyAssetHashesOfNode(node).length > 0)
      .map((node) => node.id),
    ...assetIds,
  ])
  const cleanedByRefs = draft ? cleanEcommerceDraftRefs(draft, validNodeIds) : null
  const cleaned = cleanedByRefs
    ? {
        ...cleanedByRefs,
        referenceNodeIds: [...new Set(cleanedByRefs.referenceNodeIds)],
      }
    : null
  const products = (cleaned?.productNodeIds ?? [])
    .map(uploadOf)
    .filter((upload): upload is EcommerceDraftUploadProjection => upload !== null)
  const references = (cleaned?.referenceNodeIds ?? [])
    .map(uploadOf)
    .filter((upload): upload is EcommerceDraftUploadProjection => upload !== null)

  if (draft && cleaned && refsChanged(draft, cleaned)) {
    void ports.repository.save(ports.projectId, cleaned)
  }
  return { draft: cleaned, products, references }
}

export interface EcommerceDraftAutoSaveScheduler {
  setTimeout(callback: () => void, milliseconds: number): number
  clearTimeout(timer: number): void
}

export interface EcommerceDraftAutoSaveState {
  getLatest(): EcommerceFormDraft | null
  setLatest(draft: EcommerceFormDraft): void
}

export interface EcommerceDraftAutoSavePorts {
  save(draft: EcommerceFormDraft): Promise<unknown> | unknown
  scheduler: EcommerceDraftAutoSaveScheduler
  state: EcommerceDraftAutoSaveState
}

export interface EcommerceDraftAutoSaveController {
  change(draft: EcommerceFormDraft): void
  flush(): void
  dispose(): void
}

export interface EcommercePageDraftActionPorts {
  projectId: string
  repository: EcommerceDraftRecoveryRepository
  assets: EcommerceDraftRecoveryPorts['assets']
  scheduler: EcommerceDraftAutoSaveScheduler
  state: EcommerceDraftAutoSaveState
}

export interface EcommercePageDraftActionCoordinator extends EcommerceDraftAutoSaveController {
  restore(isCancelled?: () => boolean): Promise<EcommerceDraftRecoveryResult | null>
}

/** Builds the host's two draft entry points without exposing storage or React. */
export function createEcommercePageDraftActionCoordinator(
  ports: EcommercePageDraftActionPorts,
): EcommercePageDraftActionCoordinator {
  const autoSave = createEcommerceDraftAutoSaveController({
    save: (draft) => ports.repository.save(ports.projectId, draft),
    scheduler: ports.scheduler,
    state: ports.state,
  })
  return {
    ...autoSave,
    restore: (isCancelled) =>
      restoreEcommercePageDraft({
        projectId: ports.projectId,
        repository: ports.repository,
        assets: ports.assets,
        isCancelled,
      }),
  }
}

/**
 * One timer owns the debounced write. Replacing input cancels the previous
 * timer, while flush/dispose persist the latest draft exactly once per call.
 */
export function createEcommerceDraftAutoSaveController(
  ports: EcommerceDraftAutoSavePorts,
): EcommerceDraftAutoSaveController {
  let timer: number | null = null

  const cancel = () => {
    if (timer === null) return
    ports.scheduler.clearTimeout(timer)
    timer = null
  }
  const persistLatest = () => {
    const draft = ports.state.getLatest()
    if (draft) void ports.save(draft)
  }
  const flush = () => {
    cancel()
    persistLatest()
  }

  return {
    change(draft) {
      ports.state.setLatest(draft)
      cancel()
      timer = ports.scheduler.setTimeout(() => {
        timer = null
        persistLatest()
      }, ECOMMERCE_DRAFT_AUTOSAVE_MS)
    },
    flush,
    dispose: flush,
  }
}
