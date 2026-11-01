import { fingerprintBytes } from '../../domain/shared/hash'
import { imageInputsOf } from '../../domain/shared/execution/inputs'
import { imageSizeFromHeader } from '../../domain/shared/imageSize'
import type { ModelCapability } from '../../domain/shared/capability'
import type {
  DeclarativeAuth,
  DeclarativeGenerationSpec,
  DeclarativeProtocolRecipe,
  DeclarativeRequestSpec,
  DeclarativeTaskSpec,
} from '../../domain/project/protocolRecipe'
import { asAppError, errorTextOf } from '../../shared/result'
import type { NetworkResponse, SafeChannelConfig } from '../ports'
import { bytesToBase64 } from './base64'
import { prepareModelImageInput } from './chatImageInput'
import {
  authHeader,
  classifyError,
  fileExtensionOf,
  openAiBaseUrl,
  toModelCapability,
  IMAGE_ASSET_DOWNLOAD_TIMEOUT_MS,
  IMAGE_GENERATE_TIMEOUT_MS,
  IMAGE_TASK_POLL_TIMEOUT_MS,
  VERIFY_TIMEOUT_MS,
} from './openaiCommon'
import {
  ChannelError,
  type ChannelAdapter,
  type ChannelDeps,
  type GeneratedAsset,
  type ImageRunRequest,
  type TextRunRequest,
  type TextResult,
  type VideoRunRequest,
  type VerifyResult,
} from './types'

export interface DeclarativeHttpConfig extends SafeChannelConfig {
  apiKey: string | null
  recipe: DeclarativeProtocolRecipe
}

export interface DeclarativeHttpOptions {
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
  now?: () => number
}

type JsonPathToken = string | number | '*'

function parseJsonPath(path: string): JsonPathToken[] {
  if (path === '$') return []
  if (!path.startsWith('$')) return []
  const tokens: JsonPathToken[] = []
  let index = 1
  while (index < path.length) {
    if (path[index] === '.') {
      const match = /^\.([A-Za-z0-9_-]+)/.exec(path.slice(index))
      if (!match?.[1]) return []
      tokens.push(match[1])
      index += match[0].length
      continue
    }
    if (path[index] === '[') {
      const match = /^\[(\d+|\*)\]/.exec(path.slice(index))
      if (!match?.[1]) return []
      tokens.push(match[1] === '*' ? '*' : Number.parseInt(match[1], 10))
      index += match[0].length
      continue
    }
    return []
  }
  return tokens
}

export function extractJsonPath(value: unknown, path: string): unknown[] {
  const tokens = parseJsonPath(path)
  if (tokens.length === 0) return path === '$' ? [value] : []
  let current: unknown[] = [value]
  for (const token of tokens) {
    const next: unknown[] = []
    for (const node of current) {
      if (token === '*') {
        if (Array.isArray(node)) next.push(...node)
        else if (node && typeof node === 'object') next.push(...Object.values(node))
      } else if (typeof token === 'number') {
        if (Array.isArray(node) && token >= 0 && token < node.length) next.push(node[token])
      } else if (node && typeof node === 'object' && token in node) {
        next.push((node as Record<string, unknown>)[token])
      }
    }
    current = next
  }
  return current
}

function firstString(values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return null
}

function flattenStrings(value: unknown, depth = 0): string[] {
  if (depth > 8 || value == null) return []
  if (typeof value === 'string' && value.trim()) return [value.trim()]
  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenStrings(item, depth + 1))
  }
  if (typeof value !== 'object') return []
  const row = value as Record<string, unknown>
  const out: string[] = []
  for (const key of ['url', 'b64_json', 'base64', 'image_url', 'video_url', 'data']) {
    if (key in row) out.push(...flattenStrings(row[key], depth + 1))
  }
  return [...new Set(out)]
}

function valuesForPaths(body: unknown, paths: readonly string[]): string[] {
  return [
    ...new Set(
      paths.flatMap((path) =>
        extractJsonPath(body, path).flatMap((value) => flattenStrings(value)),
      ),
    ),
  ]
}

function acceptedAfterSubmit(message: string): ChannelError {
  return new ChannelError({
    kind: 'execution',
    detail: 'accepted',
    message,
  })
}

function waitFor(ms: number, signal: AbortSignal): Promise<void> {
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

function cloneJson<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}

function bytesBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

function renderString(value: string, variables: Record<string, unknown>): unknown {
  const whole = /^\{\{\s*([A-Za-z0-9_]+)\s*\}\}$/.exec(value)
  if (whole?.[1]) return cloneJson(variables[whole[1]])
  return value.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_match, name: string) =>
    String(variables[name] ?? ''),
  )
}

export function renderProtocolTemplate(
  template: unknown,
  variables: Record<string, unknown>,
): unknown {
  if (typeof template === 'string') return renderString(template, variables)
  if (Array.isArray(template)) {
    return template.map((item) => renderProtocolTemplate(item, variables))
  }
  if (!template || typeof template !== 'object') return template
  const row = template as Record<string, unknown>
  if (typeof row.$var === 'string') {
    return cloneJson(variables[row.$var])
  }
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      renderProtocolTemplate(value, variables),
    ]),
  )
}

function textFromMessageContent(value: unknown): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  return value
    .map((part) => {
      if (typeof part === 'string') return part
      if (!part || typeof part !== 'object') return ''
      const row = part as Record<string, unknown>
      return typeof row.text === 'string' ? row.text : ''
    })
    .filter(Boolean)
    .join('\n')
}

function promptFromText(request: TextRunRequest): string {
  const messages = request.messages ?? []
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role === 'user') return textFromMessageContent(message.content)
  }
  return request.prompt
}

async function dataUriImages(
  request: ImageRunRequest | VideoRunRequest | TextRunRequest,
  deps: ChannelDeps,
): Promise<{ dataUris: string[]; base64: string[]; files: { blob: Blob; name: string }[] }> {
  const dataUris: string[] = []
  const base64: string[] = []
  const files: { blob: Blob; name: string }[] = []
  for (const item of imageInputsOf(request.inputs)) {
    const payload = await deps.assets.read(item.assetHash).catch(() => null)
    if (!payload || payload.bytes.length === 0) continue
    const prepared = await prepareModelImageInput({
      bytes: payload.bytes,
      mime: payload.mime || item.mime,
    })
    const b64 = bytesToBase64(prepared.bytes)
    dataUris.push(`data:${prepared.mime};base64,${b64}`)
    base64.push(b64)
    files.push({
      blob: new Blob([bytesBuffer(prepared.bytes)], { type: prepared.mime }),
      name: `image-${files.length + 1}.${fileExtensionOf(prepared.mime)}`,
    })
  }
  return { dataUris, base64, files }
}

function base64OrDataUri(value: string): { bytes: Uint8Array; mime: string } | null {
  const data = /^data:([^;,]+);base64,([\s\S]+)$/i.exec(value)
  if (data?.[2]) {
    try {
      return {
        bytes: Uint8Array.from(atob(data[2].replace(/\s+/g, '')), (c) =>
          c.charCodeAt(0),
        ),
        mime: data[1] || 'application/octet-stream',
      }
    } catch {
      return null
    }
  }
  if (value.length >= 128 && /^[A-Za-z0-9+/=\r\n]+$/.test(value)) {
    try {
      return {
        bytes: Uint8Array.from(atob(value.replace(/\s+/g, '')), (c) =>
          c.charCodeAt(0),
        ),
        mime: 'application/octet-stream',
      }
    } catch {
      return null
    }
  }
  return null
}

function authParts(auth: DeclarativeAuth, apiKey: string | null): {
  headers: Record<string, string>
  query: Record<string, string>
} {
  if (auth.type === 'none' || !apiKey) return { headers: {}, query: {} }
  if (auth.type === 'bearer') {
    return {
      headers: { [auth.header || 'Authorization']: `Bearer ${apiKey}` },
      query: {},
    }
  }
  if (auth.type === 'header') {
    return {
      headers: { [auth.name]: `${auth.prefix ?? ''}${apiKey}` },
      query: {},
    }
  }
  if (auth.type === 'query') return { headers: {}, query: { [auth.name]: apiKey } }
  return {
    headers: {
      Authorization: `Basic ${btoa(`${auth.username || 'api'}:${apiKey}`)}`,
    },
    query: {},
  }
}

function safeRelativeUrl(base: string, path: string): string {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('..')) {
    throw new ChannelError({ kind: 'channel', detail: 'unsupported' })
  }
  return `${base.replace(/\/+$/, '')}${path}`
}

function serverErrorFrom(body: unknown): string {
  if (!body || typeof body !== 'object') return ''
  const row = body as Record<string, unknown>
  const error = row.error
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const item = error as Record<string, unknown>
    return [item.code, item.message, item.detail]
      .filter((part): part is string => typeof part === 'string' && Boolean(part.trim()))
      .join(': ')
  }
  return [row.message, row.detail]
    .filter((part): part is string => typeof part === 'string' && Boolean(part.trim()))
    .join(': ')
}

function modelCategoryOf(
  item: unknown,
  recipe: DeclarativeProtocolRecipe,
): ModelCapability['category'] | undefined {
  const fixed = recipe.models.category
  if (fixed && fixed !== 'unknown') return fixed
  if (recipe.models.categoryPath) {
    const raw = firstString(extractJsonPath(item, recipe.models.categoryPath))
    const mapped = raw ? recipe.models.categoryMap?.[raw.toLowerCase()] : undefined
    if (mapped && mapped !== 'unknown') return mapped
  }
  return undefined
}

export function createDeclarativeHttpAdapter(
  config: DeclarativeHttpConfig,
  deps: ChannelDeps,
  options: DeclarativeHttpOptions = {},
): ChannelAdapter {
  const base = openAiBaseUrl(config)
  const recipe = config.recipe
  const sleep = options.sleep ?? waitFor
  const now = options.now ?? (() => Date.now())

  const send = async (
    spec: DeclarativeRequestSpec,
    variables: Record<string, unknown>,
    signal: AbortSignal,
    defaultTimeout = IMAGE_GENERATE_TIMEOUT_MS,
  ): Promise<NetworkResponse> => {
    const auth = authParts(recipe.auth, config.apiKey)
    const path = String(renderProtocolTemplate(spec.path, variables))
    const url = new URL(safeRelativeUrl(base, path))
    const query = {
      ...auth.query,
      ...Object.fromEntries(
        Object.entries(spec.query ?? {}).map(([key, value]) => [
          key,
          String(renderProtocolTemplate(value, variables)),
        ]),
      ),
    }
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value)
    }
    const renderedBody =
      spec.body === undefined ? undefined : renderProtocolTemplate(spec.body, variables)
    const headers: Record<string, string> = {
      ...auth.headers,
      ...Object.fromEntries(
        Object.entries(spec.headers ?? {}).map(([key, value]) => [
          key,
          String(renderProtocolTemplate(value, variables)),
        ]),
      ),
    }
    let body: unknown
    if (spec.contentType === 'multipart') {
      const form = new FormData()
      for (const [key, value] of Object.entries(
        renderedBody && typeof renderedBody === 'object'
          ? (renderedBody as Record<string, unknown>)
          : {},
      )) {
        const values = Array.isArray(value) ? value : [value]
        for (const item of values) {
          if (typeof item === 'string') {
            const decoded = base64OrDataUri(item)
            if (decoded) {
              form.append(
                key,
                new Blob([bytesBuffer(decoded.bytes)], { type: decoded.mime }),
                `upload-${key}.${fileExtensionOf(decoded.mime)}`,
              )
            } else {
              form.append(key, item)
            }
          } else if (item != null && typeof item === 'object') {
            form.append(key, JSON.stringify(item))
          } else if (item != null) {
            form.append(key, String(item))
          }
        }
      }
      body = form
    } else if (renderedBody !== undefined) {
      headers['Content-Type'] ??= 'application/json'
      body = JSON.stringify(renderedBody)
    }
    return deps.network.request(
      {
        url: url.toString(),
        method: spec.method ?? 'GET',
        headers,
        ...(body === undefined ? {} : { body }),
        timeoutMs: spec.timeoutMs ?? defaultTimeout,
      },
      signal,
    )
  }

  const readJson = async (response: NetworkResponse): Promise<unknown> => {
    const raw = await response.text()
    try {
      return JSON.parse(raw) as unknown
    } catch {
      throw new ChannelError({
        kind: 'parse',
        raw: raw.slice(0, 2_000),
      })
    }
  }

  const models = async (signal: AbortSignal): Promise<ModelCapability[]> => {
    const response = await send(
      recipe.models.request,
      {},
      signal,
      recipe.models.request.timeoutMs ?? VERIFY_TIMEOUT_MS,
    )
    if (response.status < 200 || response.status >= 300) {
      const detail = await response.text().catch(() => '')
      const { error } = classifyError(null, response.status, detail)
      throw new ChannelError(error)
    }
    const body = await readJson(response)
    const items = extractJsonPath(body, recipe.models.items)
    const out: ModelCapability[] = []
    const seen = new Set<string>()
    for (const item of items) {
      const id = firstString(extractJsonPath(item, recipe.models.id))
      if (!id || seen.has(id)) continue
      seen.add(id)
      out.push(toModelCapability(id, modelCategoryOf(item, recipe)))
    }
    return out
  }

  const verify: ChannelAdapter['verify'] = async (_cfg, signal): Promise<VerifyResult> => {
    try {
      return { ok: true, models: await models(signal) }
    } catch (error) {
      const app = asAppError(error)
      return {
        ok: false,
        error: app ?? { kind: 'parse', raw: errorTextOf(error) },
        message: errorTextOf(error),
      }
    }
  }

  const completeText: ChannelAdapter['completeText'] = async (request, signal) => {
    if (!recipe.chat) throw new ChannelError({ kind: 'channel', detail: 'unsupported' })
    const images = await dataUriImages(request, deps)
    const variables = {
      model: request.model,
      prompt: promptFromText(request),
      text: request.prompt,
      messages: request.messages ?? [{ role: 'user', content: request.prompt }],
      tools: request.tools ?? [],
      images: images.dataUris,
      imagesBase64: images.base64,
      params: request.params,
    }
    const response = await send(recipe.chat.request, variables, signal)
    if (response.status < 200 || response.status >= 300) {
      const detail = await response.text().catch(() => '')
      const { error } = classifyError(null, response.status, detail)
      throw new ChannelError(error)
    }
    const body = await readJson(response)
    const text = firstString(extractJsonPath(body, recipe.chat.response.text))
    if (text == null) {
      const reason = serverErrorFrom(body)
      throw new ChannelError({
        kind: 'parse',
        raw: reason || '聊天响应里没有找到 text 路径',
      })
    }
    const reasoning =
      recipe.chat.response.reasoning
        ? firstString(extractJsonPath(body, recipe.chat.response.reasoning))
        : null
    const rawToolCalls = recipe.chat.response.toolCalls
      ? extractJsonPath(body, recipe.chat.response.toolCalls)
      : []
    const toolCalls = rawToolCalls.flatMap((item, index) => {
      if (!item || typeof item !== 'object') return []
      const row = item as Record<string, unknown>
      const fn =
        row.function && typeof row.function === 'object'
          ? (row.function as Record<string, unknown>)
          : row
      const name =
        typeof fn.name === 'string'
          ? fn.name
          : typeof row.name === 'string'
            ? row.name
            : ''
      const args =
        typeof fn.arguments === 'string'
          ? fn.arguments
          : typeof row.arguments === 'string'
            ? row.arguments
            : ''
      if (!name) return []
      return [
        {
          id:
            typeof row.id === 'string' && row.id
              ? row.id
              : `call_${index + 1}`,
          name,
          args: args || '{}',
        },
      ]
    })
    const finishRaw =
      recipe.chat.response.finishReason
        ? firstString(extractJsonPath(body, recipe.chat.response.finishReason))
        : null
    const finishReason =
      toolCalls.length > 0
        ? 'tool_calls'
        : finishRaw === 'length'
          ? 'length'
          : 'stop'
    const result: TextResult = {
      text,
      finishReason,
      ...(reasoning ? { reasoning } : {}),
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    }
    return result
  }

  const downloadAssets = async (
    body: unknown,
    resultPaths: readonly string[],
    mime: string | undefined,
    kind: 'image' | 'video',
    signal: AbortSignal,
  ): Promise<GeneratedAsset[]> => {
    const strings = valuesForPaths(body, resultPaths)
    const defaultMime = mime || (kind === 'video' ? 'video/mp4' : 'image/png')
    const out: GeneratedAsset[] = []
    for (const value of strings) {
      const inline = base64OrDataUri(value)
      let bytes: Uint8Array | null = inline?.bytes ?? null
      let mime = inline?.mime || defaultMime
      if (!bytes) {
        try {
          const url = new URL(value)
          const response = await deps.network.request(
            {
              url: url.toString(),
              method: 'GET',
              headers:
                url.origin === new URL(base).origin
                  ? authHeader(config.apiKey)
                  : {},
              timeoutMs: IMAGE_ASSET_DOWNLOAD_TIMEOUT_MS,
            },
            signal,
          )
          if (response.status < 200 || response.status >= 300) continue
          bytes = new Uint8Array(await response.arrayBuffer())
          mime =
            response.headers['content-type']?.split(';')[0]?.trim() ||
            defaultMime
        } catch {
          if (kind === 'video') {
            const hash = await fingerprintBytes(new TextEncoder().encode(value))
            out.push({
              hash,
              mime: defaultMime,
              bytes: new Uint8Array(),
              url: value,
            })
          }
          continue
        }
      }
      if (!bytes || bytes.length === 0) continue
      const hash = await fingerprintBytes(bytes)
      const actual = kind === 'image' ? imageSizeFromHeader(bytes) : null
      out.push({
        hash,
        mime,
        bytes,
        ...(actual ? { width: actual.width, height: actual.height } : {}),
      })
    }
    return out
  }

  const runTask = async (
    task: DeclarativeTaskSpec,
    variables: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<unknown> => {
    const response = await send(task.poll, variables, signal, IMAGE_TASK_POLL_TIMEOUT_MS)
    if (response.status < 200 || response.status >= 300) {
      const detail = await response.text().catch(() => '')
      const { error } = classifyError(null, response.status, detail)
      throw new ChannelError(error)
    }
    return readJson(response)
  }

  const generate = async (
    request: ImageRunRequest | VideoRunRequest,
    generation: DeclarativeGenerationSpec,
    kind: 'image' | 'video',
    signal: AbortSignal,
  ): Promise<GeneratedAsset[]> => {
    const images = await dataUriImages(request, deps)
    const variables = {
      model: request.model,
      prompt: request.prompt,
      text: request.prompt,
      images: images.dataUris,
      imagesBase64: images.base64,
      count: request.params.count ?? 1,
      size: request.params.size ?? '',
      ratio: request.params.ratio ?? '',
      resolution: request.params.resolution ?? '',
      params: request.params,
      duration: request.params.duration ?? '',
      fps: request.params.fps ?? '',
    }
    let submitted: NetworkResponse
    try {
      submitted = await send(generation.request, variables, signal)
    } catch (error) {
      if (signal.aborted) throw error
      const app = asAppError(error)
      if (app && (app.kind === 'channel' || app.kind === 'validation')) throw error
      throw acceptedAfterSubmit(`提交结果未知：${errorTextOf(error)}`)
    }
    if (submitted.status === 408 || submitted.status === 429 || submitted.status >= 500) {
      const detail = await submitted.text().catch(() => '')
      throw acceptedAfterSubmit(`提交结果未知：HTTP ${submitted.status} ${detail}`)
    }
    if (submitted.status < 200 || submitted.status >= 300) {
      const detail = await submitted.text().catch(() => '')
      const { error } = classifyError(null, submitted.status, detail)
      throw new ChannelError(error)
    }
    const submittedBody = await readJson(submitted)
    const immediate = await downloadAssets(
      submittedBody,
      generation.result ?? [],
      generation.mime,
      kind,
      signal,
    )
    if (immediate.length > 0 || !generation.task) return immediate

    const taskId = firstString(extractJsonPath(submittedBody, generation.task.id))
    if (!taskId) {
      throw new ChannelError({
        kind: 'parse',
        raw: serverErrorFrom(submittedBody) || '异步响应里没有 task id',
      })
    }
    const taskVariables = { ...variables, taskId }
    const startedAt = now()
    let lastError = ''
    for (
      let attempt = 0;
      attempt < (generation.task.maxPolls ?? 180) &&
      now() - startedAt < (generation.task.timeoutMs ?? 600_000);
      attempt += 1
    ) {
      if (attempt > 0) await sleep(generation.task.intervalMs ?? 2_000, signal)
      let body: unknown
      try {
        body = await runTask(generation.task, taskVariables, signal)
      } catch (error) {
        if (signal.aborted) throw error
        lastError = errorTextOf(error)
        continue
      }
      const status =
        firstString(extractJsonPath(body, generation.task.status))?.toUpperCase() ?? ''
      if ((generation.task.failure ?? []).includes(status)) {
        throw acceptedAfterSubmit(
          `任务 ${taskId} 失败：${serverErrorFrom(body) || status || '服务端未给原因'}`,
        )
      }
      if (generation.task.success.includes(status)) {
        const assets = await downloadAssets(
          body,
          generation.task.result,
          generation.mime,
          kind,
          signal,
        )
        if (assets.length > 0) return assets
        throw new ChannelError({
          kind: 'parse',
          raw: `任务 ${taskId} 已完成，但结果路径没有找到产物`,
        })
      }
    }
    throw acceptedAfterSubmit(
      `任务 ${taskId} 已提交，但轮询超时或结果未知${lastError ? `：${lastError}` : ''}`,
    )
  }

  const generateImage: ChannelAdapter['generateImage'] = async (request, signal) => {
    if (!recipe.image) throw new ChannelError({ kind: 'channel', detail: 'unsupported' })
    return generate(request, recipe.image, 'image', signal)
  }

  const generateVideo: ChannelAdapter['generateVideo'] = async (request, signal) => {
    if (!recipe.video) throw new ChannelError({ kind: 'channel', detail: 'unsupported' })
    return generate(request, recipe.video, 'video', signal)
  }

  return {
    protocol: config.protocol,
    verify,
    listModels: (_cfg, signal) => models(signal),
    generateImage,
    generateVideo,
    completeText,
  }
}
