import { describe, expect, it } from 'vitest'
import {
  escapeControlCharactersInStrings,
  parseAgentToolArguments,
} from './agentToolArgs'

describe('parseAgentToolArguments', () => {
  it('★★ 自动修复提示词字符串里的未转义换行', () => {
    const raw = '{"prompt":"第一行\n第二行","ratio":"16:9"}'

    expect(parseAgentToolArguments(raw)).toEqual({
      prompt: '第一行\n第二行',
      ratio: '16:9',
    })
  })

  it('★ 已经转义的内容保持原语义', () => {
    const raw = String.raw`{"prompt":"第一行\n第二行","quote":"\""}`

    expect(parseAgentToolArguments(raw)).toEqual({
      prompt: '第一行\n第二行',
      quote: '"',
    })
    expect(escapeControlCharactersInStrings(raw)).toBe(raw)
  })

  it('★ 非控制字符造成的结构错误仍然拒绝', () => {
    expect(() => parseAgentToolArguments('{"nodes":[}')).toThrow()
  })
})
