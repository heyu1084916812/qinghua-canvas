import {
  CUSTOM_SIZE_MAX_EDGE as MAX_EDGE,
  CUSTOM_SIZE_MAX_PIXELS as MAX_PIXELS,
  CUSTOM_SIZE_SNAP as SNAP,
} from '../../../domain/canvas/layout/customSize'
import type { ImageParamSpec } from '../../../domain/canvas/layout/imageParams'

export interface RequestedImageDimensions {
  width?: number
  height?: number
}

const RES_PIXEL_BUDGET: Record<'1k' | '2k' | '4k', number> = {
  '1k': 1024 * 1024,
  '2k': 2048 * 2048,
  '4k': 4096 * 4096,
}

/**
 * 比例 + 画质档位必须翻译成 OpenAI 规范的像素 size。`1:1` 直接替换成 `1x1`
 * 会被真实模型拒绝；4K 1:1 按用户确认的 2880×2880 特批发。
 * 自定义尺寸规则仍住在 domain/canvas/layout/customSize，面板与传输层共用同一份。
 */

export const GEMINI_DEFAULT_RATIO = 'auto'

const OPENAI_QUALITIES = new Set(['auto', 'low', 'medium', 'high'])

export function openAiImageSize(ratio: unknown, resolution?: unknown): string | null {
  if (typeof ratio !== 'string') return null
  const [rawW, rawH] = ratio.replace(/\s+/g, '').split(':').map((s) => Number.parseFloat(s))
  if (!Number.isFinite(rawW) || !Number.isFinite(rawH) || rawW <= 0 || rawH <= 0) return null
  const aspect = rawW / rawH
  if (Math.max(aspect, 1 / aspect) > 3) return null
  const wanted = typeof resolution === 'string' ? resolution.trim().toLowerCase() : ''
  const tier = wanted === '2k' ? '2k' : wanted === '4k' ? '4k' : '1k'
  const budget = RES_PIXEL_BUDGET[tier]
  if (tier === '4k' && Math.abs(aspect - 1) < 1e-9) return '2880x2880'
  const long = Math.min(Math.sqrt(budget * Math.max(aspect, 1 / aspect)), MAX_EDGE)
  let w = Math.round((long * (aspect >= 1 ? 1 : aspect)) / SNAP) * SNAP
  let h = Math.round((long * (aspect >= 1 ? 1 / aspect : 1)) / SNAP) * SNAP
  if (w > MAX_EDGE) w = Math.floor(MAX_EDGE / SNAP) * SNAP
  if (h > MAX_EDGE) h = Math.floor(MAX_EDGE / SNAP) * SNAP
  while (w * h > MAX_PIXELS) {
    const shrinkW = w >= h
    if (shrinkW) {
      w = Math.max(SNAP, w - SNAP)
      h = Math.max(SNAP, Math.round((w / aspect) / SNAP) * SNAP)
    } else {
      h = Math.max(SNAP, h - SNAP)
      w = Math.max(SNAP, Math.round((h * aspect) / SNAP) * SNAP)
    }
  }
  return `${w}x${h}`
}

export function openAiImageQuality(quality: unknown, allowed?: readonly string[]): string | null {
  if (typeof quality !== 'string') return null
  if (quality === 'auto') return null
  if (allowed) return allowed.includes(quality) ? quality : null
  return OPENAI_QUALITIES.has(quality) ? quality : null
}

/* `auto` 等价于不指定字段；旧节点或没有能力表的模型也不能把它发出去。 */

export function specImageSize(resolution: unknown, spec: ImageParamSpec): string {
  const wanted = typeof resolution === 'string' ? resolution.trim() : ''
  if (spec.dialect === 'tier') {
    const upper = wanted.toUpperCase()
    return spec.sizes.find((s) => s.toUpperCase() === upper) ?? spec.sizes[0] ?? '1K'
  }
  return spec.sizes.includes(wanted) ? wanted : (spec.sizes[0] ?? '1024x1024')
}

export function sizeToDimensions(size: string | null): RequestedImageDimensions {
  const m = size ? /^(\d+)x(\d+)$/.exec(size) : null
  if (!m) return {}
  return { width: Number(m[1]), height: Number(m[2]) }
}

export function imageUrlFromChatContent(content: unknown): string | null {
  if (typeof content !== 'string') return null
  const md = /!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/.exec(content)
  if (md?.[1]) return md[1]
  const bare = /(https?:\/\/[^\s)]+\.(?:png|jpe?g|webp|gif))/i.exec(content)
  return bare?.[1] ?? null
}
