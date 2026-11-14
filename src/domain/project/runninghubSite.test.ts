import { describe, expect, it } from 'vitest'
import { runninghubSiteNote, runninghubSiteOf } from './runninghubSite'

describe('RunningHub 站点判定', () => {
  it('认国内站 / 国际站，带不带 www、http(s)、尾斜杠都算同一站', () => {
    expect(runninghubSiteOf('https://www.runninghub.cn')).toBe('cn')
    expect(runninghubSiteOf('https://runninghub.cn/')).toBe('cn')
    expect(runninghubSiteOf('http://api.runninghub.cn')).toBe('cn')
    expect(runninghubSiteOf('https://www.runninghub.ai')).toBe('global')
    expect(runninghubSiteOf('runninghub.ai')).toBe('global')
  })

  it('自建反代 / 空地址当「未知」，不硬猜是哪一站', () => {
    expect(runninghubSiteOf('https://my-proxy.example.com')).toBe('unknown')
    expect(runninghubSiteOf('')).toBe('unknown')
  })
})

describe('协议说明按站点改写', () => {
  const fallback = '协议原文'

  it('国内站强调「标准模型 API 只对企业级 Key 开放」', () => {
    const note = runninghubSiteNote({ protocol: 'runninghub-api', baseUrl: 'https://www.runninghub.cn' }, fallback)
    expect(note).toContain('国内站')
    expect(note).toContain('1014')
    expect(note).not.toContain('协议原文')
  })

  it('国际站不写那条限制，只说两站各自独立', () => {
    const note = runninghubSiteNote({ protocol: 'runninghub-api', baseUrl: 'https://www.runninghub.ai' }, fallback)
    expect(note).toContain('国际站')
    expect(note).toContain('两个账号')
    expect(note).not.toContain('1014')
  })

  it('别的协议原样用目录里那句话', () => {
    expect(runninghubSiteNote({ protocol: 'agnes', baseUrl: 'https://x' }, fallback)).toBe(fallback)
    expect(runninghubSiteNote(null, fallback)).toBe(fallback)
  })
})
