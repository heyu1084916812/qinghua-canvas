import {
  capabilityOfLogical,
  channelIdForLogical,
  type CatalogChannelLike,
} from '../../domain/project/modelCatalog'

/**
 * 「设置 → 默认参数」保存时，配方该记在**哪条渠道**上。
 *
 * Agent 实测 Bug A1（2026-11-11）：面板原先直接用 `defaultForNewNode` 解析出的
 * `resolved.channelId` 去 `setDefaultRecipe`。那个渠道是「当前默认」算出来的，
 * 可能是一条对话渠道（例：对话站记过配方、生图默认只是固定显示名兜底）。
 * 用户在下拉里换了生图模型再保存，配方就落成「对话渠道 + 生图模型」——
 * 新建节点拿到它，请求发到不提供该模型的站点，配方等于失效。
 *
 * 正确做法：按用户**选中的模型**找真正提供它的**启用**渠道（与选路同一条
 * `channelIdForLogical` 搜索；勾选优先），且提供者的分类必须与当前类别一致。
 * 找不到 → `undefined`，调用方不写配方（宁可提示，也不写一份跑不起来的默认）。
 *
 * `preferChannelId`：同优先度多条渠道都能提供时，沿用当前解析出的那条。
 */
export function defaultRecipeChannelFor(
  channels: readonly CatalogChannelLike[],
  model: string,
  category: 'image' | 'video' | 'chat',
  preferChannelId?: string,
): string | undefined {
  const name = model.trim()
  if (!name) return undefined
  const enabled = channels.filter((channel) => channel.enabled)
  const channelId = channelIdForLogical(enabled, name, preferChannelId)
  if (!channelId) return undefined
  const capability = capabilityOfLogical(enabled, name, preferChannelId)
  if (capability && capability.category !== 'unknown' && capability.category !== category) {
    return undefined
  }
  return channelId
}
