export type DeclarativeProtocolCapability = 'chat' | 'image' | 'video'
export type DeclarativeHttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'
export type DeclarativeContentType = 'json' | 'multipart'

export type DeclarativeAuth =
  | { type: 'none' }
  | { type: 'bearer'; header?: string }
  | { type: 'header'; name: string; prefix?: string }
  | { type: 'query'; name: string }
  | { type: 'basic'; username?: string }

export interface DeclarativeRequestSpec {
  method?: DeclarativeHttpMethod
  path: string
  contentType?: DeclarativeContentType
  query?: Record<string, string>
  headers?: Record<string, string>
  body?: unknown
  timeoutMs?: number
}

export interface DeclarativeModelsSpec {
  request: DeclarativeRequestSpec
  items: string
  id: string
  category?: DeclarativeProtocolCapability | 'audio' | 'unknown'
  categoryPath?: string
  categoryMap?: Record<string, DeclarativeProtocolCapability | 'audio' | 'unknown'>
}

export interface DeclarativeChatSpec {
  request: DeclarativeRequestSpec
  response: {
    text: string
    reasoning?: string
    finishReason?: string
    toolCalls?: string
  }
}

export interface DeclarativeTaskSpec {
  id: string
  poll: DeclarativeRequestSpec
  status: string
  success: string[]
  failure?: string[]
  result: string[]
  intervalMs?: number
  maxPolls?: number
  timeoutMs?: number
}

export interface DeclarativeGenerationSpec {
  request: DeclarativeRequestSpec
  result?: string[]
  mime?: string
  task?: DeclarativeTaskSpec
}

export interface DeclarativeProtocolRecipe {
  version: 1
  auth: DeclarativeAuth
  models: DeclarativeModelsSpec
  chat?: DeclarativeChatSpec
  image?: DeclarativeGenerationSpec
  video?: DeclarativeGenerationSpec
}

export interface DeclarativeProtocolPackage {
  schema: 'qinghua.protocol/v1'
  id?: string
  name: string
  short?: string
  versionPath?: string
  docUrl?: string
  capabilities: DeclarativeProtocolCapability[]
  recipe: DeclarativeProtocolRecipe
}

export type DeclarativeProtocolParseResult =
  | { ok: true; value: DeclarativeProtocolPackage }
  | { ok: false; reason: string }

const ID_RE = /^[a-z0-9][a-z0-9_-]{1,31}$/
const PATH_RE = /^\/(?!\/)(?:[^\s?#]|#)*$/
const HEADER_RE = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/
const ALLOWED_METHODS = new Set<DeclarativeHttpMethod>(['GET', 'POST', 'PUT', 'DELETE'])
const ALLOWED_VARIABLES = new Set([
  'model',
  'prompt',
  'text',
  'messages',
  'tools',
  'images',
  'imagesBase64',
  'count',
  'size',
  'ratio',
  'resolution',
  'taskId',
  'params',
  'duration',
  'fps',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function stringMap(value: unknown, field: string): Record<string, string> | undefined {
  if (value == null) return undefined
  if (!isRecord(value)) throw new Error(`${field} 必须是字符串键值对象`)
  const out: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    if (!HEADER_RE.test(key)) throw new Error(`${field}.${key} 不是合法字段名`)
    if (typeof item !== 'string') throw new Error(`${field}.${key} 必须是字符串`)
    out[key] = item
  }
  return out
}

function validatePath(value: unknown, field: string): string {
  const path = text(value)
  if (!path) throw new Error(`${field} 不能为空`)
  if (!PATH_RE.test(path) || path.includes('/../') || path.endsWith('/..')) {
    throw new Error(`${field} 必须是站内相对路径，并以 / 开头`)
  }
  return path
}

function validateJsonPath(value: unknown, field: string, optional = false): string | undefined {
  const path = text(value)
  if (!path && optional) return undefined
  if (!path.startsWith('$')) throw new Error(`${field} 必须是以 $ 开头的取值路径`)
  return path
}

function validateVariables(value: unknown, field: string): void {
  if (typeof value === 'string') {
    for (const match of value.matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)) {
      const name = match[1] ?? ''
      if (!ALLOWED_VARIABLES.has(name)) {
        throw new Error(`${field} 使用了不支持的变量 {{${name}}}`)
      }
    }
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateVariables(item, `${field}[${index}]`))
    return
  }
  if (!isRecord(value)) return
  if ('$var' in value) {
    const name = text(value.$var)
    if (!ALLOWED_VARIABLES.has(name)) {
      throw new Error(`${field}.$var 使用了不支持的变量 ${name || '(空)'}`)
    }
    if (Object.keys(value).length !== 1) {
      throw new Error(`${field}.$var 对象只能包含一个 $var 字段`)
    }
    return
  }
  for (const [key, item] of Object.entries(value)) {
    validateVariables(item, `${field}.${key}`)
  }
}

function normalizeRequest(value: unknown, field: string): DeclarativeRequestSpec {
  if (!isRecord(value)) throw new Error(`${field} 必须是对象`)
  const rawMethod = text(value.method).toUpperCase() || 'GET'
  const method = rawMethod as DeclarativeHttpMethod
  if (!ALLOWED_METHODS.has(method)) throw new Error(`${field}.method 只支持 GET / POST / PUT / DELETE`)
  const rawContentType = text(value.contentType).toLowerCase() || 'json'
  if (rawContentType !== 'json' && rawContentType !== 'multipart') {
    throw new Error(`${field}.contentType 只支持 json / multipart`)
  }
  const headers = stringMap(value.headers, `${field}.headers`)
  const query = stringMap(value.query, `${field}.query`)
  if (value.body != null && method === 'GET') {
    throw new Error(`${field}.body 不能和 GET 方法一起使用`)
  }
  validateVariables(value.body, `${field}.body`)
  for (const [key, item] of Object.entries(headers ?? {})) {
    validateVariables(item, `${field}.headers.${key}`)
  }
  for (const [key, item] of Object.entries(query ?? {})) {
    validateVariables(item, `${field}.query.${key}`)
  }
  const timeoutMs =
    typeof value.timeoutMs === 'number' && Number.isFinite(value.timeoutMs)
      ? Math.min(600_000, Math.max(1_000, Math.trunc(value.timeoutMs)))
      : undefined
  return {
    method,
    path: validatePath(value.path, `${field}.path`),
    contentType: rawContentType,
    ...(query ? { query } : {}),
    ...(headers ? { headers } : {}),
    ...(value.body !== undefined ? { body: value.body } : {}),
    ...(timeoutMs ? { timeoutMs } : {}),
  }
}

function normalizeAuth(value: unknown): DeclarativeAuth {
  if (value == null) return { type: 'bearer' }
  if (!isRecord(value)) throw new Error('auth 必须是对象')
  const type = text(value.type).toLowerCase() || 'bearer'
  if (type === 'none') return { type: 'none' }
  if (type === 'bearer') {
    const header = text(value.header) || 'Authorization'
    if (!HEADER_RE.test(header)) throw new Error('auth.header 不是合法请求头')
    return { type: 'bearer', header }
  }
  if (type === 'header') {
    const name = text(value.name)
    if (!HEADER_RE.test(name)) throw new Error('auth.name 必须是合法请求头')
    return {
      type: 'header',
      name,
      ...(typeof value.prefix === 'string' ? { prefix: value.prefix } : {}),
    }
  }
  if (type === 'query') {
    const name = text(value.name)
    if (!name) throw new Error('auth.name 不能为空')
    return { type: 'query', name }
  }
  if (type === 'basic') {
    return {
      type: 'basic',
      ...(typeof value.username === 'string' && value.username
        ? { username: value.username }
        : {}),
    }
  }
  throw new Error('auth.type 只支持 none / bearer / header / query / basic')
}

function normalizeModels(value: unknown): DeclarativeModelsSpec {
  if (!isRecord(value)) throw new Error('models 必须是对象')
  const request = normalizeRequest(value.request, 'models.request')
  request.method = request.method ?? 'GET'
  const items = validateJsonPath(value.items, 'models.items')!
  const id = validateJsonPath(value.id, 'models.id')!
  const category = text(value.category).toLowerCase()
  const allowedCategory = ['chat', 'image', 'video', 'audio', 'unknown']
  if (category && !allowedCategory.includes(category)) {
    throw new Error('models.category 只能是 chat / image / video / audio / unknown')
  }
  const categoryPath = validateJsonPath(value.categoryPath, 'models.categoryPath', true)
  const rawMap = value.categoryMap
  if (rawMap != null && !isRecord(rawMap)) {
    throw new Error('models.categoryMap 必须是对象')
  }
  const categoryMap: Record<string, DeclarativeProtocolCapability | 'audio' | 'unknown'> = {}
  for (const [key, item] of Object.entries(rawMap ?? {})) {
    const mapped = text(item).toLowerCase()
    if (!allowedCategory.includes(mapped)) {
      throw new Error(`models.categoryMap.${key} 分类不受支持`)
    }
    categoryMap[key.toLowerCase()] = mapped as DeclarativeProtocolCapability | 'audio' | 'unknown'
  }
  return {
    request,
    items,
    id,
    ...(category
      ? { category: category as DeclarativeProtocolCapability | 'audio' | 'unknown' }
      : {}),
    ...(categoryPath ? { categoryPath } : {}),
    ...(Object.keys(categoryMap).length > 0 ? { categoryMap } : {}),
  }
}

function normalizeChat(value: unknown): DeclarativeChatSpec {
  if (!isRecord(value)) throw new Error('chat 必须是对象')
  const request = normalizeRequest(value.request, 'chat.request')
  if (!isRecord(value.response)) throw new Error('chat.response 必须是对象')
  return {
    request,
    response: {
      text: validateJsonPath(value.response.text, 'chat.response.text')!,
      ...(validateJsonPath(value.response.reasoning, 'chat.response.reasoning', true)
        ? {
            reasoning: validateJsonPath(
              value.response.reasoning,
              'chat.response.reasoning',
              true,
            )!,
          }
        : {}),
      ...(validateJsonPath(value.response.finishReason, 'chat.response.finishReason', true)
        ? {
            finishReason: validateJsonPath(
              value.response.finishReason,
              'chat.response.finishReason',
              true,
            )!,
          }
        : {}),
      ...(validateJsonPath(value.response.toolCalls, 'chat.response.toolCalls', true)
        ? {
            toolCalls: validateJsonPath(
              value.response.toolCalls,
              'chat.response.toolCalls',
              true,
            )!,
          }
        : {}),
    },
  }
}

function pathArray(value: unknown, field: string, required = true): string[] {
  const values = Array.isArray(value) ? value : value == null ? [] : [value]
  const paths = values.map((item, index) =>
    validateJsonPath(item, `${field}[${index}]`)!,
  )
  if (required && paths.length === 0) throw new Error(`${field} 至少需要一个取值路径`)
  return paths
}

function statusArray(value: unknown, field: string, required = true): string[] {
  const values = Array.isArray(value) ? value : value == null ? [] : [value]
  const statuses = values.map((item, index) => {
    const status = text(item)
    if (!status) throw new Error(`${field}[${index}] 必须是非空状态字符串`)
    return status.toUpperCase()
  })
  if (required && statuses.length === 0) {
    throw new Error(`${field} 至少需要一个状态`)
  }
  return statuses
}

function normalizeGeneration(value: unknown, field: string): DeclarativeGenerationSpec {
  if (!isRecord(value)) throw new Error(`${field} 必须是对象`)
  const request = normalizeRequest(value.request, `${field}.request`)
  const result = pathArray(value.result, `${field}.result`, false)
  const taskRaw = value.task
  if (result.length === 0 && taskRaw == null) {
    throw new Error(`${field} 需要 result（同步）或 task（异步）`)
  }
  let task: DeclarativeTaskSpec | undefined
  if (taskRaw != null) {
    if (!isRecord(taskRaw)) throw new Error(`${field}.task 必须是对象`)
    const intervalMs =
      typeof taskRaw.intervalMs === 'number' && Number.isFinite(taskRaw.intervalMs)
        ? Math.min(60_000, Math.max(200, Math.trunc(taskRaw.intervalMs)))
        : 2_000
    const maxPolls =
      typeof taskRaw.maxPolls === 'number' && Number.isFinite(taskRaw.maxPolls)
        ? Math.min(1_000, Math.max(1, Math.trunc(taskRaw.maxPolls)))
        : 180
    const timeoutMs =
      typeof taskRaw.timeoutMs === 'number' && Number.isFinite(taskRaw.timeoutMs)
        ? Math.min(900_000, Math.max(5_000, Math.trunc(taskRaw.timeoutMs)))
        : 600_000
    task = {
      id: validateJsonPath(taskRaw.id, `${field}.task.id`)!,
      poll: normalizeRequest(taskRaw.poll, `${field}.task.poll`),
      status: validateJsonPath(taskRaw.status, `${field}.task.status`)!,
      success: statusArray(taskRaw.success, `${field}.task.success`),
      ...(taskRaw.failure == null
        ? {}
        : {
            failure: statusArray(taskRaw.failure, `${field}.task.failure`, false),
          }),
      result: pathArray(taskRaw.result, `${field}.task.result`),
      intervalMs,
      maxPolls,
      timeoutMs,
    }
  }
  return {
    request,
    ...(result.length > 0 ? { result } : {}),
    ...(typeof value.mime === 'string' && value.mime.trim()
      ? { mime: value.mime.trim() }
      : {}),
    ...(task ? { task } : {}),
  }
}

function extractJson(source: string): string {
  const trimmed = source.replace(/^\uFEFF/, '').trim()
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed)
  if (fenced?.[1]) return fenced[1].trim()
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  return start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed
}

export function parseDeclarativeProtocol(
  source: string,
): DeclarativeProtocolParseResult {
  try {
    const parsed = JSON.parse(extractJson(source)) as unknown
    if (!isRecord(parsed)) throw new Error('协议文件必须是 JSON 对象')
    if (parsed.schema !== 'qinghua.protocol/v1') {
      throw new Error('schema 必须是 qinghua.protocol/v1')
    }
    const name = text(parsed.name)
    if (!name || name.length > 80) throw new Error('name 必填，且最多 80 个字符')
    const rawId = text(parsed.id)
    if (rawId && !ID_RE.test(rawId)) {
      throw new Error('id 只能用小写字母、数字、- 和 _，且以字母或数字开头（2–32 位）')
    }
    const short = text(parsed.short)
    if (short.length > 8) throw new Error('short 最多 8 个字符')
    const versionPath = text(parsed.versionPath)
    if (versionPath && (!PATH_RE.test(versionPath) || versionPath.includes('/../'))) {
      throw new Error('versionPath 必须是站内路径')
    }
    const auth = normalizeAuth(parsed.auth)
    const models = normalizeModels(parsed.models)
    const chat = parsed.chat == null ? undefined : normalizeChat(parsed.chat)
    const image =
      parsed.image == null ? undefined : normalizeGeneration(parsed.image, 'image')
    const video =
      parsed.video == null ? undefined : normalizeGeneration(parsed.video, 'video')
    const capabilities: DeclarativeProtocolCapability[] = []
    if (chat) capabilities.push('chat')
    if (image) capabilities.push('image')
    if (video) capabilities.push('video')
    if (capabilities.length === 0) {
      throw new Error('至少需要 chat / image / video 中的一种能力')
    }
    return {
      ok: true,
      value: {
        schema: 'qinghua.protocol/v1',
        ...(rawId ? { id: rawId } : {}),
        name,
        ...(short ? { short } : {}),
        ...(versionPath ? { versionPath } : {}),
        ...(text(parsed.docUrl) ? { docUrl: text(parsed.docUrl) } : {}),
        capabilities,
        recipe: {
          version: 1,
          auth,
          models,
          ...(chat ? { chat } : {}),
          ...(image ? { image } : {}),
          ...(video ? { video } : {}),
        },
      },
    }
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}

export const DECLARATIVE_PROTOCOL_TEMPLATE = `轻画自定义协议模板（qinghua.protocol/v1）

把下面整段交给 AI，同时提供站点 API 文档。要求 AI 只输出一个 JSON 对象。
重要限制：
1. 不要写 API Key、Cookie 或账号密码。
2. path 只能写站点内的相对路径，例如 /v1/models。
3. 只能使用下列变量：{{model}} {{prompt}} {{text}} {{messages}} {{tools}}
   {{images}} {{imagesBase64}} {{count}} {{size}} {{ratio}} {{resolution}}
   {{taskId}} {{params}} {{duration}} {{fps}}。
4. 数组或对象需要原样传入时，使用 {"$var":"messages"} 这种写法。
5. 取值路径使用简化 JSONPath，例如 $.data[*].id、$.choices[0].message.content。
6. 不支持任意 JavaScript、签名脚本、OAuth 或跨域名请求。

字段说明：
- auth.type：none / bearer / header / query / basic。
- models.items 指向模型数组，models.id 是每项里的模型 ID 字段。
- chat.request 发送对话；chat.response.text 是正文取值路径。
- image.result 用于一次请求就返回图片的同步接口。
- 异步图片不要写 image.result，改写 image.task：
  id 取任务号，poll 是轮询请求，status 是状态字段，
  success / failure 是状态值数组，result 是最终产物路径数组。
  可选 intervalMs、maxPolls、timeoutMs。
- video 与 image 的写法相同。
- 需要 multipart 文件上传时，request.contentType 写 multipart，
  图片字段使用 {"$var":"images"}。
- JSONPath 只支持点字段、数字下标和 [*]，不支持过滤表达式或脚本。

\`\`\`json
{
  "schema": "qinghua.protocol/v1",
  "name": "示例站点",
  "short": "示例",
  "versionPath": "/v1",
  "docUrl": "https://example.com/docs",
  "auth": {
    "type": "bearer"
  },
  "models": {
    "request": {
      "method": "GET",
      "path": "/models"
    },
    "items": "$.data[*]",
    "id": "$.id",
    "category": "chat"
  },
  "chat": {
    "request": {
      "method": "POST",
      "path": "/chat/completions",
      "body": {
        "model": "{{model}}",
        "messages": {
          "$var": "messages"
        },
        "tools": {
          "$var": "tools"
        }
      }
    },
    "response": {
      "text": "$.choices[0].message.content",
      "reasoning": "$.choices[0].message.reasoning_content",
      "finishReason": "$.choices[0].finish_reason",
      "toolCalls": "$.choices[0].message.tool_calls[*]"
    }
  },
  "image": {
    "request": {
      "method": "POST",
      "path": "/images/generations",
      "body": {
        "model": "{{model}}",
        "prompt": "{{prompt}}",
        "n": "{{count}}",
        "size": "{{size}}"
      }
    },
    "result": [
      "$.data[*].url"
    ]
  }
}
\`\`\`
`
