import type { PresetModel, PresetVendor } from '../../domain/project/modelPresets'
import type { ProtocolKind } from '../../domain/project/protocol'

export const MAP_FILTERS = [
  { key: 'image', title: '生图' },
  { key: 'chat', title: '对话' },
  { key: 'video', title: '视频' },
  { key: 'audio', title: '音频' },
] as const

export type MapFilterKey = (typeof MAP_FILTERS)[number]['key']

export type ChannelFilterKey = 'all' | 'enabled' | 'disabled'

export const CHANNEL_FILTER_OPTIONS: { value: ChannelFilterKey; label: string }[] = [
  { value: 'all', label: '全部服务商' },
  { value: 'enabled', label: '仅已启用' },
  { value: 'disabled', label: '仅已禁用' },
]

export function channelInitial(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() ?? '?'
}

export function channelMonogramTone(name: string): number {
  let hash = 0
  for (const char of name) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0
  return hash % 6
}

export function measureProfileDrawerBounds() {
  const rect = document
    .querySelector<HTMLElement>('[data-settings-workarea]')
    ?.getBoundingClientRect()
  if (!rect || rect.width <= 0 || rect.height <= 0) return null
  return {
    left: Math.round(rect.left),
    top: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  }
}

export const GLOBAL_MODEL_VENDORS: { value: PresetVendor; label: string }[] = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'google', label: 'Google' },
  { value: 'midjourney', label: 'Midjourney' },
  { value: 'bytedance', label: '字节跳动' },
  { value: 'minimax', label: 'MiniMax' },
  { value: 'fal', label: 'fal' },
  { value: 'alibaba', label: '阿里' },
  { value: 'agnes', label: 'Agnes' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'zhipu', label: '智谱' },
  { value: 'tencent', label: '腾讯' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'xai', label: 'xAI' },
  { value: 'mistral', label: 'Mistral' },
  { value: 'moonshot', label: 'Moonshot' },
  { value: 'baidu', label: '百度' },
  { value: 'cohere', label: 'Cohere' },
  { value: 'perplexity', label: 'Perplexity' },
  { value: 'stability', label: 'Stability' },
  { value: 'runway', label: 'Runway' },
  { value: 'luma', label: 'Luma' },
  { value: 'ideogram', label: 'Ideogram' },
  { value: 'bfl', label: 'BFL' },
  { value: 'recraft', label: 'Recraft' },
  { value: 'kling', label: '可灵' },
  { value: 'suno', label: 'Suno' },
  { value: 'elevenlabs', label: 'ElevenLabs' },
  { value: 'ollama', label: 'Ollama' },
  { value: 'huggingface', label: 'Hugging Face' },
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'siliconcloud', label: '硅基流动' },
  { value: 'modelscope', label: 'ModelScope' },
  { value: 'doubao', label: '豆包' },
  { value: 'volcengine', label: '火山引擎' },
  { value: 'flux', label: 'FLUX' },
  { value: 'jimeng', label: '即梦' },
]


/**
 * 协议下拉的分组顺序（用户 2026-09-28「一站一协议」）。
 *
 * 分组只影响**看见的顺序**，不影响行为：`kind` 与协议目录里的取值同字面。
 * 站点排在前是因为「一站一条渠道」之后，用户多数时候是在选具体站点；
 * 公开模板与旧协议往下放，避免它们挤掉最常用的那几条。
 */
export const PROTOCOL_GROUPS: { kind: ProtocolKind; label: string }[] = [
  { kind: 'offline', label: '离线 / 测试' },
  { kind: 'station', label: '站点' },
  { kind: 'public', label: '公开协议' },
  { kind: 'legacy', label: '旧协议' },
  { kind: 'custom', label: '自定义协议' },
]

/**
 * 后台模型设置页（产品文档 §7）。
 * 左：渠道列表（可拖动排序）；右：选中渠道的配置（名称 / 地址 / 加密令牌 / 启用 / 协议 / 验证）
 * + 模型管理（§7.4：拉取 → 勾选 → 已选三行分组）。
 * 所有写操作经 useChannels() 的 channel store，直连 storage + 凭据层，不进画布 undo 栈。
 */
/**
 * **一行令牌**（用户第 22 批 #358：「RunningHub有两个令牌，一个是币的，一个是金额的，做在一个渠道里面」）。
 *
 * 为什么抽成组件：原来那段内联 JSX 只服务"一把钥匙"，再接一把就得复制一份 ——
 * 两份迟早分叉。这里按 `slot` 驱动，**协议声明了几把就渲染几行**。
 *
 * "已保存"的判据是外面传进来的**尾号**（`savedTail`）：它是 store 里的真相，
 * 组件自己不再存一份 `tokenSaved`；存完 / 删完由 store 变化把新尾号推下来。
 * 明文依旧只在保存那一瞬间经手（`saveToken` 之后本地清空输入框）。
 */
export type { PresetModel, PresetVendor }
