import { imageUrlFromChatContent } from './imageParams'
import type { ImageItem } from './contracts'

export type GeminiImagePayload =
  | { kind: 'inline'; data: string; mimeType: string }
  | { kind: 'url'; url: string; mimeType?: string }

function geminiCandidates(body: unknown): unknown[] {
  if (!body || typeof body !== 'object') return []
  const row = body as Record<string, unknown>
  const nested =
    row.response && typeof row.response === 'object'
      ? (row.response as Record<string, unknown>)
      : null
  const candidates = row.candidates ?? nested?.candidates
  return Array.isArray(candidates) ? candidates : []
}

function contentPartsOf(candidate: unknown): unknown[] {
  if (!candidate || typeof candidate !== 'object') return []
  const content = (candidate as { content?: unknown }).content
  if (!content || typeof content !== 'object') return []
  const parts = (content as { parts?: unknown }).parts
  return Array.isArray(parts) ? parts : []
}

function stringAt(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function findGeminiImage(body: unknown): GeminiImagePayload | null {
  /**
   * 中转站把 Gemini 图片放在后续 candidate、蛇形 inline_data、fileUri、
   * 正文 markdown / data URI，甚至 OpenAI chat 形状里；只认第一个 candidate
   * 会把真实产物误报成「没有图片」。
   */
  for (const candidate of geminiCandidates(body)) {
    for (const part of contentPartsOf(candidate)) {
      if (!part || typeof part !== 'object') continue
      const p = part as {
        inlineData?: { data?: unknown; mimeType?: unknown }
        inline_data?: { data?: unknown; mime_type?: unknown }
        fileData?: { fileUri?: unknown; mimeType?: unknown }
        file_data?: { file_uri?: unknown; mime_type?: unknown }
        text?: unknown
      }
      const data = p.inlineData?.data ?? p.inline_data?.data
      const mimeType =
        p.inlineData?.mimeType ??
        p.inline_data?.mime_type ??
        p.fileData?.mimeType ??
        p.file_data?.mime_type
      if (typeof data === 'string' && data.trim()) {
        const dataUri = /^data:([^;,]+);base64,(.*)$/is.exec(data.trim())
        return {
          kind: 'inline',
          data: (dataUri?.[2] ?? data).replace(/\s+/g, ''),
          mimeType:
            dataUri?.[1] ??
            (typeof mimeType === 'string' ? mimeType : 'image/png'),
        }
      }
      const fileUri = p.fileData?.fileUri ?? p.file_data?.file_uri
      if (typeof fileUri === 'string' && /^https?:\/\//i.test(fileUri)) {
        return {
          kind: 'url',
          url: fileUri,
          ...(typeof mimeType === 'string' ? { mimeType } : {}),
        }
      }
      if (typeof p.text === 'string') {
        const url = imageUrlFromChatContent(p.text)
        if (url) {
          return {
            kind: 'url',
            url,
            ...(typeof mimeType === 'string' ? { mimeType } : {}),
          }
        }
        const dataUri = /data:(image\/[^;,]+);base64,([^\s)]+)/i.exec(p.text)
        if (dataUri?.[1] && dataUri[2]) {
          return {
            kind: 'inline',
            data: dataUri[2].replace(/\s+/g, ''),
            mimeType: dataUri[1],
          }
        }
      }
    }
  }

  const choices = (body as { choices?: unknown[] } | null)?.choices
  if (Array.isArray(choices)) {
    for (const choice of choices) {
      const text = stringAt(
        (choice as { message?: { content?: unknown } } | null)?.message?.content,
      )
      const url = text ? imageUrlFromChatContent(text) : null
      if (url) return { kind: 'url', url }
    }
  }
  return null
}

export function findInlineImage(
  body: unknown,
): { data: string; mimeType: string } | null {
  const image = findGeminiImage(body)
  return image?.kind === 'inline'
    ? { data: image.data, mimeType: image.mimeType }
    : null
}

export function geminiNoImageReason(body: unknown): string {
  if (!body || typeof body !== 'object') return '服务端返回为空'
  const row = body as Record<string, unknown>
  const promptFeedback = row.promptFeedback as
    | { blockReason?: unknown; blockReasonMessage?: unknown }
    | undefined
  const candidates = geminiCandidates(body)
  const parts = candidates.flatMap(contentPartsOf)
  const text = parts
    .map((part) =>
      part && typeof part === 'object'
        ? stringAt((part as { text?: unknown }).text)
        : null,
    )
    .filter((value): value is string => Boolean(value))
    .join('\n')
    .trim()
  const finishReasons = candidates
    .map((candidate) =>
      candidate && typeof candidate === 'object'
        ? stringAt((candidate as { finishReason?: unknown }).finishReason)
        : null,
    )
    .filter((value): value is string => Boolean(value))
  const block = stringAt(promptFeedback?.blockReasonMessage) ?? stringAt(promptFeedback?.blockReason)
  return (
    [block, finishReasons.length > 0 ? `结束原因：${[...new Set(finishReasons)].join(', ')}` : '', text]
      .filter(Boolean)
      .join('；')
      .slice(0, 500) || '响应里没有图片，也没有可读的文字原因'
  )
}

export function imageItemsIn(value: unknown): ImageItem[] {
  /* 包装层可能嵌套 data/output/results/body；同一 URL 或 Base64 只收一次。 */
  const out: ImageItem[] = []
  const seen = new Set<string>()
  const push = (item: ImageItem): void => {
    const key = item.url ? `url:${item.url}` : item.b64_json ? `b64:${item.b64_json.slice(0, 64)}` : ''
    if (!key || seen.has(key)) return
    seen.add(key)
    out.push(item)
  }
  const visit = (node: unknown, depth: number): void => {
    if (node == null || depth > 8) return
    if (typeof node === 'string') {
      const text = node.trim()
      if (/^https?:\/\//i.test(text) || /^data:image\//i.test(text)) {
        push({ url: text })
      } else if (text.length >= 256 && /^[A-Za-z0-9+/=\r\n]+$/.test(text)) {
        push({ b64_json: text })
      }
      return
    }
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1)
      return
    }
    if (typeof node !== 'object') return
    const row = node as Record<string, unknown>
    const urls = Array.isArray(row.url)
      ? row.url.filter((item): item is string => typeof item === 'string')
      : typeof row.url === 'string'
        ? [row.url]
        : []
    for (const key of [
      'image_url',
      'imageUrl',
      'output_url',
      'outputUrl',
      'file_url',
      'fileUrl',
      'image_large_url',
    ]) {
      const value = row[key]
      if (typeof value === 'string' && value) urls.push(value)
      if (Array.isArray(value)) {
        urls.push(...value.filter((item): item is string => typeof item === 'string'))
      }
    }
    const preferredUrl =
      urls.find((item) => /^https?:\/\//i.test(item)) ??
      urls.find((item) => /^data:image\//i.test(item))
    const b64Values = Array.isArray(row.b64_json)
      ? row.b64_json.filter((item): item is string => typeof item === 'string')
      : typeof row.b64_json === 'string'
        ? [row.b64_json]
        : []
    if (preferredUrl) {
      push({
        url: preferredUrl,
        fallbackUrls: urls.filter((item) => item !== preferredUrl),
        ...(b64Values[0] ? { fallbackB64: b64Values[0] } : {}),
      })
    }
    if (!preferredUrl && b64Values[0]) push({ b64_json: b64Values[0] })
    for (const key of [
      'data',
      'output',
      'outputs',
      'images',
      'result',
      'results',
      'image',
      'response',
      'body',
    ]) {
      if (key in row) visit(row[key], depth + 1)
    }
  }
  visit(value, 0)
  return out
}
