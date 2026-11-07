import { describe, expect, it } from 'vitest'
import { hostingErrorText } from './hostingErrorText'

describe('hostingErrorText', () => {
  it('★★ AppError HTTP 500 翻成人话，不出 [object Object]', () => {
    expect(hostingErrorText({ kind: 'http', status: 500 })).toContain('500')
  })

  it('★★ 网络 dns 抛出翻成人话', () => {
    expect(hostingErrorText({ kind: 'network', detail: 'dns' })).toContain('解析不了')
  })

  it('★ Error / 字符串 / 普通对象逐层兜底', () => {
    expect(hostingErrorText(new Error('boom'))).toBe('boom')
    expect(hostingErrorText('直接是字符串')).toBe('直接是字符串')
    expect(hostingErrorText({ message: '人话' })).toBe('人话')
  })

  it('★ 长文本截到 120', () => {
    expect(hostingErrorText('x'.repeat(121)).length).toBe(120)
  })
})
