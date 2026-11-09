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
  for (const { item, usage } of selection.selected) {
    const label = item.title.trim() || item.id
    lines.push(
      `- 【${label}】这是什么：${item.what.trim()}；本轮怎么用：${usage.howToUse.trim()}；用法类型：${usage.usage}。`,
    )
    evidence.push(`${item.id}:${usage.id}`)
    if (
      item.assetHash &&
      (item.kind === 'image' || item.kind === 'video')
    ) {
      const mime = assetMime(item.assetHash)
      if (mime) {
        assetRefs.push({
          hash: item.assetHash,
          mime,
          role: usage.usage === 'identityAnchor' ? 'logo' : 'reference',
          name: label,
        })
      }
    }
  }
  const omitted = selection.omitted.length
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
    ...(evidence.length > 0
      ? {
          phaseEvent: {
            phase: 'referenceAnalysis',
            title: agentPhaseCollapsedSummary({
              phase: 'referenceAnalysis',
              title: '参考分析完成',
              evidence,
            }),
            detail: lines.join('\n'),
            evidence,
          } satisfies AgentPhaseEvent,
        }
      : {}),
  }
}
