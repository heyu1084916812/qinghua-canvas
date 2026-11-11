import { describe, expect, it } from 'vitest'
import {
  escapeControlCharactersInStrings,
  parseAgentToolArguments,
  readPageUrlOf,
  researchDesignArgsOf,
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

describe('联网工具参数清洗', () => {
  it('researchDesign：topic 必填，queries 最多 4 个，urls 只留 http(s)，maxResults 夹到 1–24', () => {
    expect(researchDesignArgsOf({ topic: '  ' })).toBeNull()
    expect(
      researchDesignArgsOf({
        topic: ' 咖啡 ',
        queries: ['a', ' ', 'b', 'c', 'd', 'e', 3],
        urls: ['ftp://x', ' https://a.example.com ', 'javascript:1'],
        maxResults: 99.4,
      }),
    ).toEqual({
      topic: '咖啡',
      queries: ['a', 'b', 'c', 'd'],
      urls: ['https://a.example.com'],
      maxResults: 24,
    })
    expect(researchDesignArgsOf({ topic: 'x' })).toEqual({ topic: 'x' })
  })

  it('readPage：只接受 http(s)', () => {
    expect(readPageUrlOf({ url: ' https://a.example.com/p ' })).toBe('https://a.example.com/p')
    expect(readPageUrlOf({ url: 'file:///etc/passwd' })).toBeNull()
    expect(readPageUrlOf({})).toBeNull()
  })
})
