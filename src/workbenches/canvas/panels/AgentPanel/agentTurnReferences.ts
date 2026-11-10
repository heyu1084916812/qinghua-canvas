import type { GenerationContextAsset } from '../../../../domain/canvas/model/node'
import type { ReferenceSelection } from '../../../../domain/project/referenceLedger'
import {
  type AgentPhaseEvent,
  agentPhaseCollapsedSummary,
} from '../../../../domain/agent/phase'

export interface AgentTurnReferenceProjection {
  prompt: string
  assetRefs: (GenerationContextAsset & { mime: string })[]
  evidence: string[]
  warnings: string[]
  phaseEvent?: AgentPhaseEvent
}

/**
 * 把项目参考台账的 selected 转成本轮真实可用的上下文材料。
 *
 * 纯规则层不读库、不发请求、不造引用：只有带 assetHash 的图片/视频卡才可能
 * 成为生成素材；文本/颜色/字体卡只给模型文字事实。mime 由调用方补核，
 * 资产字节仍从 assets 读取。
 */
export function projectAgentTurnReferences(
  selection: ReferenceSelection,
  assetMime: (hash: string) => string | null,
): AgentTurnReferenceProjection {
  const lines: string[] = []
  const assetRefs: AgentTurnReferenceProjection['assetRefs'] = []
  const evidence: string[] = []
  const warnings: string[] = []
  for (const { item, usage } of selection.selected) {
    const label = item.title.trim() || item.id
    lines.push(
      `- 【${label}】这是什么：${item.what.trim()}；本轮怎么用：${usage.howToUse.trim()}；用法类型：${usage.usage}。`,
    )
    evidence.push(`${item.id}:${usage.id}`)
    const mediaAssets = item.assets?.length
      ? item.assets
      : item.assetHash
        ? [{
            hash: item.assetHash,
            role: usage.usage === 'identityAnchor' ? 'logo' as const : 'reference' as const,
            name: label,
          }]
        : []
    for (const asset of mediaAssets) {
      if (!asset.hash || assetRefs.some((row) => row.hash === asset.hash)) continue
      const mime = assetMime(asset.hash)
      if (!mime) {
        warnings.push(`套件素材「${asset.name.trim() || asset.hash}」已缺失，本轮已跳过。`)
        continue
      }
      assetRefs.push({
        hash: asset.hash,
        mime,
        role: asset.role,
        name: asset.name.trim() || label,
      })
    }
  }
  const omitted = selection.omitted.length
  const visibleSummary = selection.selected.map(({ item, usage }) => {
    const assetCount = item.assets?.length ?? (item.assetHash ? 1 : 0)
    return `- ${item.title.trim() || item.id}：${item.what.trim()}；本轮怎么用：${usage.howToUse.trim()}${assetCount > 0 ? `（${assetCount} 个素材）` : ''}`
  })
  const prompt = lines.length > 0
    ? [
        '## 本次任务采用的参考台账',
        `按当前任务匹配到 ${lines.length} 张参考，未采用的 ${omitted} 张不得混入生成参数。`,
        ...lines,
      ].join('\n')
    : ''
  return {
    prompt,
    assetRefs,
    evidence,
    warnings,
    ...(evidence.length > 0
      ? {
          phaseEvent: {
            phase: 'referenceAnalysis',
            title: agentPhaseCollapsedSummary({
              phase: 'referenceAnalysis',
              title: '参考分析完成',
              evidence,
            }),
            detail: [
              `已读取 ${selection.selected.length} 条参考；详细分析已记入参考台账。`,
              ...warnings,
              ...visibleSummary,
            ].join('\n'),
            evidence,
          } satisfies AgentPhaseEvent,
        }
      : {}),
  }
}
