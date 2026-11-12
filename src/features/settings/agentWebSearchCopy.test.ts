import { describe, expect, it } from 'vitest'

const sources = {
  ...import.meta.glob('./AgentWebSearchSettings.tsx', { eager: true, query: '?raw', import: 'default' }),
  ...import.meta.glob('../../workbenches/canvas/panels/AgentPanel/AgentWebResearchToggle.tsx', {
    eager: true, query: '?raw', import: 'default',
  }),
} as Record<string, string>
const read = (rel: string): string => {
  const key = rel.startsWith('features/settings/')
    ? `./${rel.slice('features/settings/'.length)}`
    : `../../${rel}`
  const source = sources[key]
  if (!source) throw new Error(`missing source: ${rel}`)
  return source
}

describe('联网调研文案（免 Key 搜索，Tavily 可选）', () => {
  it('设置页把 Tavily 标为可选备用，并说明默认免 Key 搜索与原网页兜底', () => {
    const settings = read('features/settings/AgentWebSearchSettings.tsx')
    expect(settings).toContain('（可选，已保存）')
    expect(settings).toContain('（可选，未填写）')
    expect(settings).toContain('免 Key 搜索固定设计站点')
    expect(settings).toContain('读不到时直接读取原网页')
    expect(settings).toContain('免费搜索被验证码或限流拦住时才改用 Tavily')
    expect(settings).not.toContain('用 Tavily 搜索网页与图片')
  })

  it('「联网」开关提示不再暗示必须填 Tavily Key', () => {
    const toggle = read('workbenches/canvas/panels/AgentPanel/AgentWebResearchToggle.tsx')
    expect(toggle).toContain('免 Key 搜索网页')
    expect(toggle).toContain('可选的 Tavily 备用 Key')
    expect(toggle).not.toContain('（Tavily Key 在')
  })
})
