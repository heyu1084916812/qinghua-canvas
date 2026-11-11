import {
  channelIdForLogical,
  type CatalogChannelLike,
} from '../../../../domain/project/modelCatalog'

export interface SessionChatModelInput {
  /** 对话模型下拉清单（固定显示名） */
  options: readonly string[]
  /** 按优先级排好的偏好：当前会话已选 → 保存的默认（空串自动跳过） */
  preferred: readonly string[]
  /** 全部渠道（含停用）；只认启用的 */
  channels: readonly CatalogChannelLike[]
}

/**
 * 给新会话（及初次自动建的会话）挑对话模型。
 *
 * Agent 实测 Bug A4（2026-11-11）：原规则是「保存的默认在清单里就用，否则 `options[0]`」。
 * 清单第一项是固定显示名 `Agnes 2.5 Flash`，而用户的 Agnes 渠道已停用 ⇒ 新会话
 * 一发消息就报错；用户刚在上个会话选好的模型也没被沿用。
 *
 * 规则：
 * 1. 按 `preferred` 顺序取第一个**在清单里、且有启用渠道能提供**的；
 * 2. 否则取清单里第一个有启用渠道提供的；
 * 3. 都没有 → 空串（不塞一个必然报错的停用模型）。
 */
export function pickSessionChatModel(input: SessionChatModelInput): string {
  const enabled = input.channels.filter((channel) => channel.enabled)
  const usable = (model: string): boolean =>
    Boolean(model) &&
    input.options.includes(model) &&
    channelIdForLogical(enabled, model) !== undefined
  for (const model of input.preferred) {
    if (usable(model)) return model
  }
  return input.options.find(usable) ?? ''
}
