import type { ContextKitAsset } from '../../../domain/shared/context'
import type { NodeInput } from '../../../domain/shared/execution/types'
import type { ContextRepository } from '../../../state/shared/contextRepository'

export type AssetInput = Extract<NodeInput, { kind: 'asset' }>

export interface ContextGenerationInputPorts {
  contextRepo: Pick<ContextRepository, 'bundleForProject'>
  assets: {
    read(hash: string): Promise<{ mime: string } | null>
  }
  projectId: string
  request: string
  taskId?: string
}

export function mergeContextGenerationInputs(
  inputs: readonly NodeInput[],
  contextInputs: readonly NodeInput[],
): NodeInput[] {
  const seen = new Set<string>()
  return [...inputs, ...contextInputs].filter((input) => {
    if (input.kind !== 'asset') return true
    if (seen.has(input.assetHash)) return false
    seen.add(input.assetHash)
    return true
  })
}

export function brandContextPrompt(inputs: readonly NodeInput[]): string {
  const brands = inputs.flatMap((input) => {
    const match = /^context:(logo|reference):/.exec(input.kind === 'asset' ? input.nodeId : '')
    return match ? [{ role: match[1] as 'logo' | 'reference', hash: input.kind === 'asset' ? input.assetHash : '' }] : []
  })
  if (brands.length === 0) return ''
  const seen = new Set<string>()
  const lines = brands.filter(({ hash }) => {
    if (seen.has(hash)) return false
    seen.add(hash)
    return true
  }).map(({ role }, index) => role === 'logo'
    ? `追加素材 ${index + 1}：品牌 Logo。必须忠实保留其字形、比例、颜色和标志结构；它不是无关 Logo。`
    : `追加素材 ${index + 1}：品牌参考图。仅用于视觉规范参考，不复制无关内容，不把它当作商品图替代。`)
  return [
    '品牌套件素材规则：商品图与用户显式参考图在前，以下为按最终输入顺序追加的素材。',
    ...lines,
  ].join('\n')
}

export async function contextGenerationInputs(
  ports: ContextGenerationInputPorts,
): Promise<AssetInput[]> {
  const bundle = await ports.contextRepo.bundleForProject({
    projectId: ports.projectId,
    workbench: 'ecommerce',
    request: ports.request,
    ...(ports.taskId ? { taskId: ports.taskId } : {}),
  })
  const inputs: AssetInput[] = []
  const seen = new Set<string>()
  for (const asset of bundle.assets) {
    if (seen.has(asset.hash)) continue
    seen.add(asset.hash)
    const payload = await ports.assets.read(asset.hash)
    if (!payload) throw missingContextAssetError(asset)
    if (!payload.mime.toLowerCase().startsWith('image/')) {
      throw new Error(
        `品牌套件素材「${asset.name || asset.hash}」不是图片，已停止生成，请先在套件库修复后再试。`,
      )
    }
    inputs.push({
      kind: 'asset',
      nodeId: `context:${asset.role}:${asset.hash}`,
      assetHash: asset.hash,
      mime: payload.mime,
    })
  }
  return inputs
}

function missingContextAssetError(asset: ContextKitAsset): Error {
  return new Error(
    `品牌套件素材「${asset.name || asset.hash}」已不存在，已停止生成，请先在套件库修复后再试。`,
  )
}
