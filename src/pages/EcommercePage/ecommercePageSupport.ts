import { createId } from '../../shared/id'
import { imageParamsFor } from '../../domain/shared/modelParams/imageParams'
import { imageAssetInputsOf } from '../../domain/shared/execution/inputs'
import { freshestResultsById, resultDisplayStatus } from '../../domain/ecommerce/tasks'
import type { NodeInput } from '../../domain/shared/execution/types'
import type { EcommerceResultRecord } from '../../domain/ecommerce/tasks'
import type { EcommerceRequest } from '../../domain/ecommerce/types'

export type LegacyGenerationNode = {
  id: string
  type?: string
  disabled?: boolean
  data: Record<string, unknown>
}

export function legacyAssetHashesOfNode(node: LegacyGenerationNode): string[] {
  if (node.disabled) return []
  const data = node.data
  const hashes = [
    data.assetHash,
    data.compareWith,
    data.leftAssetHash,
    data.rightAssetHash,
  ]
  const crop = data.cropContext
  if (crop && typeof crop === 'object' && !('full' in crop)) {
    const source = (crop as { source?: { assetHash?: unknown } }).source
    hashes.push(source?.assetHash)
  }
  return [
    ...new Set(
      hashes.filter(
        (hash): hash is string =>
          typeof hash === 'string' && hash.length > 0,
      ),
    ),
  ]
}

export const freshestWorkbenchResults = freshestResultsById
export const ecommerceResultDisplayStatus = resultDisplayStatus

export function ecommerceImageParamOptionsByModel(
  models: readonly string[],
): Readonly<Record<string, { resolutions: readonly string[]; qualities: readonly string[] }>> {
  return Object.fromEntries(
    models.map((name) => {
      const spec = imageParamsFor(name)
      return [
        name,
        {
          resolutions: (spec as { resolutions?: readonly string[] } | null)?.resolutions ?? [],
          qualities: (spec as { qualities?: readonly string[] } | null)?.qualities ?? [],
        },
      ]
    }),
  )
}

export function ecommerceVisualInputsOf(
  request: EcommerceRequest,
  nodes: readonly LegacyGenerationNode[],
  assets: Readonly<Record<string, { mime?: string }>>,
): Extract<NodeInput, { kind: 'asset' }>[] {
  const nodeIds = [
    ...new Set([
      request.productNodeId,
      ...(request.productNodeIds ?? []),
      ...request.referenceNodeIds,
    ]),
  ].filter(Boolean)
  const raw: NodeInput[] = []
  for (const nodeId of nodeIds) {
    const node = nodes.find((item) => item.id === nodeId)
    if (!node) {
      const payload = assets[nodeId]
      if (payload) {
        raw.push({
          kind: 'asset',
          nodeId,
          assetHash: nodeId,
          mime: payload.mime ?? 'image/png',
        })
      }
      continue
    }
    const mime =
      typeof (node.data as { assetMime?: unknown }).assetMime === 'string'
        ? ((node.data as { assetMime: string }).assetMime)
        : 'image/png'
    for (const assetHash of legacyAssetHashesOfNode(node)) {
      raw.push({ kind: 'asset', nodeId, assetHash, mime })
    }
  }
  return imageAssetInputsOf(raw)
}

export const ecommerceBatchId = () => createId('ecb')
export const ecommerceSubjectId = () => createId('ecsubject')
export type { EcommerceResultRecord }
