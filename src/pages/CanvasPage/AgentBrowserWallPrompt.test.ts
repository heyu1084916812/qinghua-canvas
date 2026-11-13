import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { PlatformProvider } from '../../app/providers/PlatformProvider'
import { createPlatform } from '../../platform'
import type { AgentBrowserPort } from '../../platform/agentBrowser'
import { browserWallStore, requestBrowserWall } from '../../features/shared/research/agentBrowserWall'
import { AgentBrowserWallPrompt } from './AgentBrowserWallPrompt'

const fakeBrowser: AgentBrowserPort = {
  load: async () => '{}',
  snapshot: async () => '{}',
  show: async () => undefined,
  hide: async () => undefined,
  close: async () => undefined,
  subscribe: () => () => undefined,
}

function render(agentBrowser?: AgentBrowserPort) {
  return renderToStaticMarkup(
    createElement(
      PlatformProvider,
      { runtime: 'memory', create: () => ({ ...createPlatform('memory'), ...(agentBrowser ? { agentBrowser } : {}) }) },
      createElement(AgentBrowserWallPrompt),
    ),
  )
}

const REQUEST = { siteId: 'pinterest' as const, label: 'Pinterest', kind: 'login' as const, reason: '需要登录', url: 'https://www.pinterest.com/' }

afterEach(() => browserWallStore.reset())

describe('AgentBrowserWallPrompt（#1088）', () => {
  it('没有待办时什么都不画', () => {
    expect(render(fakeBrowser)).toBe('')
  })

  it('有待办：标题、站点说明、继续 / 显示窗口 / 取消，且标成浮层（原生视图让位）', () => {
    void requestBrowserWall(REQUEST, new AbortController().signal)
    const html = render(fakeBrowser)
    expect(html).toContain('需要你处理一下验证/登录，完成后点继续')
    expect(html).toContain('Pinterest 需要登录')
    expect(html).toContain('data-agent-browser-wall="pinterest"')
    expect(html).toContain('data-browser-occluder')
    for (const action of ['continue', 'show', 'cancel']) expect(html).toContain(`data-agent-browser-wall-action="${action}"`)
  })

  it('多条待办只显示最早一条并注明还有几条；没有浏览器端口时不给「显示窗口」', () => {
    void requestBrowserWall(REQUEST, new AbortController().signal)
    void requestBrowserWall({ ...REQUEST, siteId: 'thedieline', label: 'The Dieline', kind: 'challenge', reason: '弹出了人机验证' }, new AbortController().signal)
    const html = render()
    expect(html).toContain('另有 1 个站点在等')
    expect(html).toContain('data-agent-browser-wall="pinterest"')
    expect(html).not.toContain('data-agent-browser-wall-action="show"')
  })
})
