import { describe, expect, it, vi } from 'vitest'
import type { NetworkPort, NetworkRequest } from '../../../platform/ports'
import {
  JINA_READER_ENDPOINT,
  parseJinaReaderText,
  READ_PAGE_FALLBACK_HINT,
  readWebPage,
} from './webPageReader'

function textResponse(text: string, status = 200) {
  return {
    status,
    headers: { 'content-type': 'text/plain' },
    text: async () => text,
    json: async <T,>() => JSON.parse(text) as T,
    arrayBuffer: async () => new ArrayBuffer(0),
  }
}

function networkOf(handler: (req: NetworkRequest) => unknown): NetworkPort {
  return {
    request: vi.fn(async (req: NetworkRequest) => handler(req)) as unknown as NetworkPort['request'],
    stream: vi.fn() as unknown as NetworkPort['stream'],
  }
}

const JINA_OK = [
  'Title: 咖啡品牌设计趋势',
  '',
  'URL Source: https://design.example.com/coffee',
  '',
  'Published Time: 2026-10-01',
  '',
  'Markdown Content:',
  '# 咖啡品牌设计趋势',
  '',
  '',
  '',
  '复古衬线字体回归，' + '色块'.repeat(50),
].join('\n')

describe('parseJinaReaderText', () => {
  it('splits header fields from markdown content', () => {
    const parsed = parseJinaReaderText(JINA_OK, 'https://fallback.example.com')
    expect(parsed.title).toBe('咖啡品牌设计趋势')
    expect(parsed.url).toBe('https://design.example.com/coffee')
    expect(parsed.content.startsWith('# 咖啡品牌设计趋势\n\n复古')).toBe(true)
    expect(parsed.warning).toBe('')
  })
})

describe('readWebPage', () => {
  it('reads through Jina Reader with the target appended, without publicOnly', async () => {
    const seen: NetworkRequest[] = []
    const network = networkOf((req) => {
      seen.push(req)
      return textResponse(JINA_OK)
    })
    const result = await readWebPage(network, 'https://design.example.com/coffee', new AbortController().signal)
    expect(seen[0]?.url).toBe(`${JINA_READER_ENDPOINT}https://design.example.com/coffee`)
    expect(seen[0]?.method).toBe('GET')
    expect(seen[0]?.publicOnly).toBeUndefined()
    expect(seen[0]?.headers?.Authorization).toBeUndefined()
    expect(result).toMatchObject({
      ok: true,
      title: '咖啡品牌设计趋势',
      url: 'https://design.example.com/coffee',
      truncated: false,
    })
  })

  it('truncates long bodies to maxChars and reports the original length', async () => {
    const body = 'x'.repeat(12_000)
    const network = networkOf(() => textResponse(`Title: Long\n\nURL Source: https://a.example.com/\n\nMarkdown Content:\n${body}`))
    const result = await readWebPage(network, 'https://a.example.com/', new AbortController().signal)
    expect(result.ok).toBe(true)
    expect(result.truncated).toBe(true)
    expect(result.totalChars).toBe(12_000)
    expect(result.content.length).toBeLessThan(8_100)
    expect(result.content.endsWith('（正文已截断）')).toBe(true)
  })

  it('refuses private addresses without any request', async () => {
    const network = networkOf(() => textResponse(JINA_OK))
    const result = await readWebPage(network, 'http://192.168.1.2/admin', new AbortController().signal)
    expect(result.ok).toBe(false)
    expect(result.hint).toBe(READ_PAGE_FALLBACK_HINT)
    expect(network.request).not.toHaveBeenCalled()
  })

  it('reports a non-2xx reader response honestly with fallbacks', async () => {
    const network = networkOf(() => {
      throw { kind: 'http', status: 403, body: 'blocked' }
    })
    const result = await readWebPage(network, 'https://www.xiaohongshu.com/explore/1', new AbortController().signal)
    expect(result).toMatchObject({ ok: false, content: '', hint: READ_PAGE_FALLBACK_HINT })
    expect(result.error).toContain('登录')
  })

  it('treats a target error warning from Jina as unreadable', async () => {
    const network = networkOf(() =>
      textResponse('Title: \n\nURL Source: https://x.example.com/\n\nWarning: Target URL returned error 404: Not Found\n\nMarkdown Content:\nNot Found'),
    )
    const result = await readWebPage(network, 'https://x.example.com/', new AbortController().signal)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('404')
  })

  it('detects short login / captcha walls', async () => {
    const network = networkOf(() =>
      textResponse('Title: 登录\n\nURL Source: https://s.example.com/\n\nMarkdown Content:\n请先登录后查看完整内容'),
    )
    const result = await readWebPage(network, 'https://s.example.com/', new AbortController().signal)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('登录或人机验证')
  })

  it('treats the real Jina login-wall shape (xiaohongshu → rednote login) as unreadable', async () => {
    const network = networkOf(() =>
      textResponse([
        'Title: Log in - rednote - share, connect, love',
        '',
        'URL Source: https://www.xiaohongshu.com/explore',
        '',
        'Final URL: https://www.rednote.com/login?redirectPath=x',
        '',
        'Warning: This page maybe requiring CAPTCHA, please make sure you are authorized to access this page.',
        '',
        'Markdown Content:',
        'Log in to get notes tailored just for you ' + 'x'.repeat(3000),
      ].join('\n')),
    )
    const result = await readWebPage(network, 'https://www.xiaohongshu.com/explore', new AbortController().signal)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('登录或人机验证')
    expect(result.hint).toBe(READ_PAGE_FALLBACK_HINT)
  })
})
