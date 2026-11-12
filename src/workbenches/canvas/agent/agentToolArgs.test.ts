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
  it('researchDesign：topic 必填，mode 明确，查询与数量参数各自夹紧', () => {
    expect(researchDesignArgsOf({ topic: '  ' })).toBeNull()
    expect(
      researchDesignArgsOf({
        topic: ' 咖啡 ',
        mode: 'mixed',
        queries: ['a', ' ', 'b', 'c', 'd', 'e', 3],
        urls: ['ftp://x', ' https://a.example.com ', 'javascript:1'],
        maxResults: 99.4,
        imageMaxResults: 12,
      }),
    ).toEqual({
      topic: '咖啡',
      mode: 'mixed',
      queries: ['a', 'b', 'c', 'd'],
      urls: ['https://a.example.com'],
      maxResults: 24,
      imageMaxResults: 30,
    })
    expect(researchDesignArgsOf({ topic: 'x' })).toEqual({ topic: 'x', mode: 'image' })
  })

  it('据意图推断模式：找图默认 image，资料查询 web，图文并重要 mixed', () => {
    expect(researchDesignArgsOf({ topic: '找一组复古咖啡海报参考' })?.mode).toBe('image')
    expect(researchDesignArgsOf({ topic: '查咖啡市场报告和行业数据' })?.mode).toBe('web')
    expect(
      researchDesignArgsOf({ topic: '既要海报图片也要相关网页文章' })?.mode,
    ).toBe('mixed')
    expect(
      researchDesignArgsOf({ topic: '2026 咖啡市场', queries: ['brand trend report'] })?.mode,
    ).toBe('web')
    expect(
      researchDesignArgsOf({ topic: '海报风格趋势', mode: 'image', queries: ['brand trend report'] })?.mode,
    ).toBe('image')
  })

  it('readPage：只接受 http(s)', () => {
    expect(readPageUrlOf({ url: ' https://a.example.com/p ' })).toBe('https://a.example.com/p')
    expect(readPageUrlOf({ url: 'file:///etc/passwd' })).toBeNull()
    expect(readPageUrlOf({})).toBeNull()
  })
})
