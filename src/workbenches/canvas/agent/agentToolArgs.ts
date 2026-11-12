import {
  inferResearchMode,
  normalizeResearchImageResults,
  type ResearchMode,
} from '../../../domain/inspiration/designResearch'

/**
 * 解析模型返回的工具参数。
 *
 * 原生 tool_calls 的 `arguments` 仍然是 JSON 字符串。部分模型会把提示词里的
 * 换行直接写进字符串，而不是输出 `\n`，导致标准 JSON.parse 失败；这类错误
 * 可以**确定性地修复**，不需要让模型整轮重试。
 *
 * 只修字符串内部的原始控制字符；其它结构错误仍然原样抛出。
 */
export function parseAgentToolArguments(raw: string): unknown {
  const text = raw.trim() || '{}'
  try {
    return JSON.parse(text)
  } catch (error) {
    const repaired = escapeControlCharactersInStrings(text)
    if (repaired === text) throw error
    return JSON.parse(repaired)
  }
}

export function escapeControlCharactersInStrings(text: string): string {
  let out = ''
  let inString = false
  let escaped = false
  for (const char of text) {
    if (!inString) {
      out += char
      if (char === '"') inString = true
      continue
    }
    if (escaped) {
      out += char
      escaped = false
      continue
    }
    if (char === '\\') {
      out += char
      escaped = true
      continue
    }
    if (char === '"') {
      out += char
      inString = false
      continue
    }
    if (char === '\n') {
      out += '\\n'
      continue
    }
    if (char === '\r') {
      out += '\\r'
      continue
    }
    if (char === '\t') {
      out += '\\t'
      continue
    }
    const code = char.codePointAt(0) ?? 0
    if (code < 0x20) {
      out += `\\u${code.toString(16).padStart(4, '0')}`
      continue
    }
    out += char
  }
  return out
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
    : []
}

export interface ResearchDesignArgs {
  topic: string
  queries?: string[]
  urls?: string[]
  maxResults?: number
  mode: ResearchMode
  imageMaxResults?: number
}

/** `researchDesign` 参数清洗：topic 必填；queries ≤4、urls ≤8、mode 明确；图片目标独立夹到 30–50。 */
export function researchDesignArgsOf(a: Record<string, unknown>): ResearchDesignArgs | null {
  const topic = typeof a.topic === 'string' ? a.topic.trim() : ''
  if (!topic) return null
  const urls = stringList(a.urls).filter((url) => /^https?:\/\//i.test(url)).slice(0, 8)
  const queries = stringList(a.queries).slice(0, 4)
  const mode = inferResearchMode({ mode: a.mode, topic, queries })
  const maxResults =
    typeof a.maxResults === 'number' && Number.isFinite(a.maxResults)
      ? Math.min(24, Math.max(1, Math.round(a.maxResults)))
      : undefined
  const imageMaxResults =
    typeof a.imageMaxResults === 'number' && Number.isFinite(a.imageMaxResults)
      ? normalizeResearchImageResults(a.imageMaxResults)
      : undefined
  return {
    topic,
    mode,
    ...(queries.length > 0 ? { queries } : {}),
    ...(urls.length > 0 ? { urls } : {}),
    ...(maxResults ? { maxResults } : {}),
    ...(imageMaxResults ? { imageMaxResults } : {}),
  }
}

/** `readPage` 参数清洗：只接受 http / https 网址。 */
export function readPageUrlOf(a: Record<string, unknown>): string | null {
  const url = typeof a.url === 'string' ? a.url.trim() : ''
  return /^https?:\/\//i.test(url) ? url : null
}
