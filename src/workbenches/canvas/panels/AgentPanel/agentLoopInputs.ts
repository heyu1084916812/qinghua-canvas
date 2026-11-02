import type {
  NodeInput,
} from '../../../../domain/shared/execution/types'
import type {
  GenerationContextAsset,
  NodeSnapshot,
} from '../../../../domain/canvas/model/node'

/**
 * 收集本轮明确引用的节点素材，再追加项目套件里尚未重复的视觉输入。
 * 节点 id 和素材 hash 分别去重；没有 assetMime 的旧节点继续按图片处理。
 */
export function collectAgentLoopInputs(
  nodes: readonly NodeSnapshot[],
  visualNodeIds: readonly string[],
  contextAssets: readonly GenerationContextAsset[] = [],
): NodeInput[] {
  const inputs = [...new Set(visualNodeIds)].flatMap(
    (nodeId): NodeInput[] => {
      const node = nodes.find((item) => item.id === nodeId)
      const data = node?.data as
        | {
            assetHash?: unknown
            assetMime?: unknown
            naturalSize?: { width: number; height: number }
          }
        | undefined
      if (!node || typeof data?.assetHash !== 'string') return []
      return [
        {
          kind: 'asset',
          nodeId: node.id,
          assetHash: data.assetHash,
          mime:
            typeof data.assetMime === 'string'
              ? data.assetMime
              : 'image/png',
          ...(data.naturalSize
            ? { naturalSize: data.naturalSize }
            : {}),
        },
      ]
    },
  )
  const existingAssetHashes = new Set(
    inputs.flatMap((input) =>
      input.kind === 'asset' ? [input.assetHash] : [],
    ),
  )
  for (const asset of contextAssets) {
    if (existingAssetHashes.has(asset.hash)) continue
    existingAssetHashes.add(asset.hash)
    inputs.push({
      kind: 'asset',
      nodeId: `context-kit:${asset.hash}`,
      assetHash: asset.hash,
      mime: asset.mime,
    })
  }
  return inputs
}
