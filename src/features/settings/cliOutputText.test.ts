import { describe, expect, it } from 'vitest'
import { hasReadableCliOutput, readableCliOutput } from './cliOutputText'

describe('CLI output readability', () => {
  it('removes replacement glyphs and control characters', () => {
    expect(readableCliOutput('cli \uFFFD\u0000 login status')).toBe('cli  login status')
  })

  it('reports unreadable output without rendering a wall of diamonds', () => {
    const raw = '\uFFFD\uFFFD\u0000'
    expect(hasReadableCliOutput(raw)).toBe(false)
    expect(readableCliOutput(raw)).toBe('（输出含不可显示字符，已省略）')
  })

  it('preserves ordinary UTF-8 text', () => {
    expect(readableCliOutput('未登录，请先执行 codex login')).toBe('未登录，请先执行 codex login')
  })

  it('strips ANSI colors while preserving the readable error', () => {
    const raw = '\u001B[31m\u001B[1merror\u001B[0m: 未登录'
    expect(readableCliOutput(raw)).toBe('error: 未登录')
    expect(hasReadableCliOutput(raw)).toBe(true)
  })
})
