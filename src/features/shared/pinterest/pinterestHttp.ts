import { bytesToBase64 } from '../../../domain/shared/base64'

export function pinterestBasicAuth(clientId: string, clientSecret: string): string {
  return bytesToBase64(new TextEncoder().encode(`${clientId}:${clientSecret}`))
}

export async function pinterestJsonPayload(
  status: number,
  text: () => Promise<string>,
): Promise<unknown> {
  const raw = await text().catch(() => '')
  if (!raw.trim()) {
    if (status >= 200 && status < 300) {
      throw new Error('Pinterest 返回了空响应')
    }
    return {}
  }
  try {
    return JSON.parse(raw) as unknown
  } catch {
    if (status >= 200 && status < 300) {
      throw new Error(`Pinterest 返回了无法解析的响应：${raw.slice(0, 200)}`)
    }
    return { message: raw.slice(0, 500) }
  }
}

export function pinterestResponseError(payload: unknown, fallback: string): string {
  const value = pinterestRecordOf(payload)
  const detail =
    pinterestTextOf(value.message) ||
    pinterestTextOf(value.error_description) ||
    pinterestTextOf(value.error)
  return detail ? `${fallback}: ${detail}` : fallback
}

export function pinterestRecordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function pinterestArrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export function pinterestTextOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
