import { beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (event: { payload: unknown }) => void

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  handlers: [] as Array<(event: { payload: unknown }) => void>,
  unlisten: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen }))

import { AGENT_BROWSER_EVENT, createTauriAgentBrowser } from './tauriAgentBrowser'

describe('桌面 Agent 后台浏览器端口', () => {
  beforeEach(() => {
    mocks.invoke.mockReset().mockResolvedValue('{"images":[]}')
    mocks.unlisten.mockReset()
    mocks.handlers.length = 0
    mocks.listen.mockReset().mockImplementation(async (_name: string, handler: Handler) => {
      mocks.handlers.push(handler)
      return mocks.unlisten
    })
  })

  it('命令名与参数名和 Rust 侧一致', async () => {
    const port = createTauriAgentBrowser()
    await expect(port.load('dribbble', 'https://dribbble.com/search/tea', 'S', { scrollSteps: 2 }))
      .resolves.toBe('{"images":[]}')
    await port.snapshot('dribbble', 'S')
    await port.show('dribbble', '标题')
    await port.hide('dribbble')
    await port.close('dribbble')
    expect(mocks.invoke.mock.calls).toEqual([
      ['agent_browser_load', { id: 'dribbble', url: 'https://dribbble.com/search/tea', script: 'S', options: { scrollSteps: 2 } }],
      ['agent_browser_snapshot', { id: 'dribbble', script: 'S' }],
      ['agent_browser_show', { id: 'dribbble', title: '标题' }],
      ['agent_browser_hide', { id: 'dribbble' }],
      ['agent_browser_close', { id: 'dribbble' }],
    ])
  })

  it('非法 id 在前端就拒绝，不发命令', async () => {
    const port = createTauriAgentBrowser()
    await expect(port.load('../x', 'https://a.com/', 'S')).rejects.toThrow('无效')
    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  it('只把本窗口的 closed 事件交给订阅者，取消后解绑', async () => {
    const port = createTauriAgentBrowser()
    const seen: string[] = []
    const off = port.subscribe('pinterest', (event) => seen.push(event.kind))
    await Promise.resolve()
    expect(mocks.listen).toHaveBeenCalledWith(AGENT_BROWSER_EVENT, expect.any(Function))
    mocks.handlers[0]!({ payload: { id: 'dribbble', kind: 'closed' } })
    mocks.handlers[0]!({ payload: { id: 'pinterest', kind: 'other' } })
    mocks.handlers[0]!({ payload: { id: 'pinterest', kind: 'closed' } })
    expect(seen).toEqual(['closed'])
    await Promise.resolve()
    off()
    expect(mocks.unlisten).toHaveBeenCalled()
  })
})
