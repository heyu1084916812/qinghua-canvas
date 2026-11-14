import type { Channel } from '../../domain/project/channel'
import type { ProtocolCatalog } from '../../domain/project/protocol'
import type { PlatformKit } from '../../platform/ports'
import { resolvedChannelConfig } from '../../platform/generation'
import { createChannelAdapter } from '../../platform/channels/registry'

/**
 * 渠道「快速测试」的一次真实调用（对账 #1117）。
 *
 * 用户 2026-11-14 的口径：这一块是**渠道公共能力**（每一个渠道页都有），
 * 参考图一是 Agnes 渠道页底部那块 —— 输入内容 + 选模型 + 「运行」→ 就地出结果，
 * 并写明「会调用正式生成接口并产生费用；验证协议 / 拉取模型不生成内容」。
 *
 * 为什么单独一个模块、不塞进 `channelStore`：那里已经有 900 多行且预算是硬上限，
 * 而这件事本质是「**按模型类别挑一个适配器方法**」的纯编排，不需要进状态。
 * 它需要的三样东西（渠道、协议目录、明文 Key）都由调用方（设置页）现拿。
 */

export type QuickTestCategory = 'image' | 'video' | 'chat'

export type QuickTestOutcome =
  | { kind: 'text'; text: string }
  | { kind: 'media'; mime: string; bytes?: Uint8Array; url?: string }

export interface QuickTestInput {
  platform: PlatformKit
  channel: Channel
  catalog: ProtocolCatalog
  /** 明文 Key（分组 Key 由调用方按分组取；没有 Key 的协议传 null） */
  apiKey: string | null
  model: string
  category: QuickTestCategory
  prompt: string
  signal: AbortSignal
}

/** 把模型的类别翻译成「这只适配器该调哪个方法」；认不出的返回 null（调用方给句人话） */
export function quickTestCategory(raw: string): QuickTestCategory | null {
  if (raw === 'image') return 'image'
  if (raw === 'video') return 'video'
  if (raw === 'chat') return 'chat'
  return null
}

export async function runChannelQuickTest(input: QuickTestInput): Promise<QuickTestOutcome> {
  const config = resolvedChannelConfig(input.channel, input.catalog, null, null)
  const adapter = createChannelAdapter({ ...config, apiKey: input.apiKey }, input.platform)
  /** 一次最小请求：不带素材、不带厂商参数覆盖 —— 测的是「这条渠道现在能不能出东西」 */
  const request = {
    channelId: input.channel.id,
    model: input.model,
    prompt: input.prompt,
    inputs: [],
    params: {},
  }

  if (input.category === 'chat') {
    const result = await adapter.completeText({ ...request, kind: 'text' }, input.signal)
    return { kind: 'text', text: result.text }
  }
  if (input.category === 'video') {
    const assets = await adapter.generateVideo({ ...request, kind: 'video' }, input.signal)
    return firstMedia(assets)
  }
  const assets = await adapter.generateImage({ ...request, kind: 'image' }, input.signal)
  return firstMedia(assets)
}

function firstMedia(assets: { mime: string; bytes?: Uint8Array; url?: string }[]): QuickTestOutcome {
  const asset = assets[0]
  /**
   * 一个产物都没有时**不伪造成功**：宁可报「渠道没返回产物」，
   * 也不拿一句「已完成」糊过去 —— 用户点这一下就是为了确认到底有没有东西。
   */
  if (!asset) throw new Error('渠道没有返回产物（响应里没有图 / 视频）')
  return { kind: 'media', mime: asset.mime, bytes: asset.bytes, url: asset.url }
}
