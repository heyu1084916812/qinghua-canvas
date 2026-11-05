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
