import { Channel, invoke } from '@tauri-apps/api/core'
import { base64ToBytes } from '../../domain/shared/base64'
import type {
  RemoteBytesPort,
  RemoteTextRequest,
  RemoteTextResponse,
  StreamChunk,
} from '../ports'
import { createLineSplitter, parseSSELine } from '../sse'

/**
 * Rust `fetch_bytes` 的返回形状（见 `src-tauri/src/lib.rs` 同名命令）。
 *
 * `content_type` 是 `Option<String>`，站点没给这个头就是 `null` —— 这里如实转成空串，
 * 让调用方只需要处理一种"没给"的形态。
 */
interface RawFetchedBytes {
  status: number
  content_type: string | null
  bytes: number[] | string
}

/** Rust `fetch_text` 的返回形状（见 `src-tauri/src/lib.rs` 同名命令） */
interface RawFetchedText {
  status: number
  headers: Record<string, string>
  text: string
  bodyBase64?: string
  finalUrl?: string
}

interface RawFetchStreamEvent {
  kind: 'chunk' | 'error' | 'done'
  text?: string
  status?: number
  message?: string
}

/**
 * **取远端字节的壳实现**（对账 #396）：一条转发，不做判断。
 *
 * 为什么不在这一层"顺手校验是不是图片"：端口只承诺"把字节取回来"，
 * "这算不算一张能用的图标"归调用方（`features/shared/channelIcon/siteIcon.ts`）——
 * 两处都判就会分出两套口径（谁改了另一处不知道）。
 *
 * `bytes` 兼容两种回来的形态：正常是 JSON 数字数组（`Vec<u8>`），
 * 但 Tauri 的 IPC 在某些通道下会把二进制给成 base64 字符串 —— 都收下，
 * 免得将来换通道时这里静默坏掉（坏法会是"图标全黑"这种最难查的样子）。
 */
export function createTauriRemoteBytes(): RemoteBytesPort {
  return {
    get: async (req) => {
      const raw = await invoke<RawFetchedBytes>('fetch_bytes', {
        url: req.url,
        timeoutMs: req.timeoutMs,
      })
      return {
        status: raw.status,
        contentType: raw.content_type ?? '',
        bytes: typeof raw.bytes === 'string' ? base64ToBytes(raw.bytes) : Uint8Array.from(raw.bytes),
      }
    },
    /**
     * 通用 HTTP（对账 #518）：转发给 `fetch_text`。
     *
     * 同样不做任何判断 —— 状态码、响应头、正文原样回给调用方，
     * "这个响应算不算一份模型列表"归渠道层判（与 `get` 那条"不校验是不是图片"同一条口径）。
     */
    request: async (
      req: RemoteTextRequest,
      signal?: AbortSignal,
    ): Promise<RemoteTextResponse> => {
      const requestId = signal ? crypto.randomUUID() : ''
      const onAbort = () => {
        if (requestId) void invoke('cancel_fetch_text', { requestId }).catch(() => {})
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      try {
        const raw = await invoke<RawFetchedText>('fetch_text', {
          url: req.url,
          method: req.method ?? 'GET',
          headers: req.headers ?? {},
          body: req.body ?? '',
          bodyBase64: req.bodyBase64 ?? '',
          contentType: req.contentType ?? '',
          multipart: req.multipart ?? [],
          timeoutMs: req.timeoutMs,
          ...(req.publicOnly ? { publicOnly: true } : {}),
          ...(req.maxResponseBytes ? { maxResponseBytes: req.maxResponseBytes } : {}),
          ...(requestId ? { requestId } : {}),
        })
        return {
          status: raw.status,
          headers: raw.headers ?? {},
          text: raw.text ?? '',
          ...(raw.finalUrl ? { finalUrl: raw.finalUrl } : {}),
          ...(raw.bodyBase64 ? { bodyBase64: raw.bodyBase64 } : {}),
        }
      } finally {
        signal?.removeEventListener('abort', onAbort)
      }
    },
    stream: async function* (
      req: RemoteTextRequest,
      signal: AbortSignal,
    ): AsyncIterable<StreamChunk> {
      const streamId = crypto.randomUUID()
      const queue: StreamChunk[] = []
      const splitter = createLineSplitter()
      let ended = false
      let wake: (() => void) | null = null
      const notify = () => {
        wake?.()
        wake = null
      }
      const onEvent = new Channel<RawFetchStreamEvent>()
      onEvent.onmessage = (event) => {
        if (event.kind === 'chunk') {
          for (const line of splitter(event.text ?? '')) {
            const chunk = parseSSELine(line)
            if (chunk) queue.push(chunk)
          }
          notify()
          return
        }
        if (event.kind === 'error') {
          queue.push(event.status
            ? {
                type: 'error',
                error: {
                  kind: 'http',
                  status: event.status,
                  body: event.message ?? event.text ?? '',
                },
              }
            : {
                type: 'error',
                error: { kind: 'network', detail: 'dns', sendPhase: 'unknown' },
              })
          ended = true
          notify()
          return
        }
        ended = true
        notify()
      }
      const cancel = () => {
        void invoke('cancel_fetch_stream', { streamId }).catch(() => undefined)
        notify()
      }
      signal.addEventListener('abort', cancel, { once: true })
      const command = invoke('fetch_stream', {
        streamId,
        url: req.url,
        method: req.method ?? 'POST',
        headers: req.headers ?? {},
        body: req.body ?? '',
        timeoutMs: req.timeoutMs,
        onEvent,
      })
      command.catch((error) => {
        if (ended) return
        queue.push({
          type: 'error',
          error: {
            kind: 'network',
            detail: 'dns',
            sendPhase: 'unknown',
          },
        })
        ended = true
        notify()
        console.debug('[agent-stream] shell stream failed', error)
      })
      try {
        while (true) {
          if (signal.aborted) {
            yield { type: 'done' }
            return
          }
          const next = queue.shift()
          if (next) {
            yield next
            if (next.type === 'done' || next.type === 'error') return
            continue
          }
          if (ended) return
          await new Promise<void>((resolve) => {
            wake = resolve
          })
        }
      } finally {
        signal.removeEventListener('abort', cancel)
        if (!ended) {
          void invoke('cancel_fetch_stream', { streamId }).catch(() => undefined)
        }
        onEvent.onmessage = () => undefined
      }
    },
  }
}
