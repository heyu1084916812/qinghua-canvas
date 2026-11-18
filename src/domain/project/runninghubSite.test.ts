import { describe, expect, it } from 'vitest'
import { runninghubSiteOf } from './runninghubSite'

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
