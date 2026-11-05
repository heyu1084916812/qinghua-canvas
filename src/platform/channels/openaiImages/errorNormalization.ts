import { asAppError, errorTextOf } from '../../../shared/result'
import { ChannelError } from '../types'
import type { SubmitNetwork } from './contracts'

export function textField(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function soonStudioErrorText(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const parts = [row.code, row.type, row.message, row.detail]
    .map(textField)
    .filter((part): part is string => Boolean(part))
  return parts.length > 0 ? [...new Set(parts)].join(': ') : null
}

export function soonStudioUpstreamErrorIn(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const seen = new Set<unknown>()
  const visit = (node: unknown, depth: number): string | null => {
    if (!node || typeof node !== 'object' || depth > 6 || seen.has(node)) return null
    seen.add(node)
    if (Array.isArray(node)) {
      for (const item of node) {
        const found = visit(item, depth + 1)
        if (found) return found
      }
      return null
    }
    const row = node as Record<string, unknown>
    const ownError = soonStudioErrorText(row.error)
    if (ownError) return ownError
    for (const key of ['response', 'body', 'data', 'result', 'results', 'error']) {
      const found = visit(row[key], depth + 1)
      if (found) return found
    }
    return null
  }
  return visit(value, 0)
}

export function isGeminiNativeRequestRequired(value: string): boolean {
  return /gemini_native_request_required|Use POST \/v1beta\/models\/|generateContent/i.test(value)
}

export function soonStudioFailureIn(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const root = value as Record<string, unknown>
  const data =
    root.data && typeof root.data === 'object'
      ? (root.data as Record<string, unknown>)
      : root
  const status = String(data.status ?? root.status ?? '').toUpperCase()
  if (status !== 'FAILURE' && status !== 'FAILED' && status !== 'ERROR') return null
  const reason = data.fail_reason ?? data.failReason ?? data.error ?? root.fail_reason ?? root.error
  return soonStudioErrorText(reason) ?? soonStudioUpstreamErrorIn(value) ?? '生成失败'
}

export function transportTextOf(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (error && typeof error === 'object' && 'detail' in error) {
    return `${String((error as { kind?: unknown }).kind ?? 'network')}/${String((error as { detail: unknown }).detail)}`
  }
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

export function acceptedAfterSubmit(message: string): ChannelError {
  /** 付费 POST 已提交后，超时 / 取消 / 轮询失败都不可重发整笔任务。 */
  return new ChannelError({
    kind: 'execution',
    detail: 'accepted',
    message,
  })
}

export function waitFor(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(new ChannelError({ kind: 'network', detail: 'aborted' }))
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new ChannelError({ kind: 'network', detail: 'aborted' }))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

export const submitNetwork: SubmitNetwork = async (label, signal, call) => {
  try {
    return await call()
  } catch (e) {
    if (signal.aborted) throw e
    const app = asAppError(e)
    if (
      app?.kind === 'http' &&
      app.status !== 408 &&
      app.status !== 429 &&
      app.status < 500
    ) {
      throw e
    }
    throw acceptedAfterSubmit(`${label}结果未知：${errorTextOf(e)}`)
  }
}

export function readNetworkDetail(res: {
  status: number
  text(): Promise<string>
}): Promise<string> {
  return res.status < 200 || res.status >= 300
    ? res.text().catch(() => '')
    : Promise.resolve('')
}
