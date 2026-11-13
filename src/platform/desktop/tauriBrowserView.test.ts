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

import { BROWSER_VIEW_EVENT, createTauriBrowserView, toBrowserViewEvent } from './tauriBrowserView'

describe('桌面原生网页视图端口', () => {
  beforeEach(() => {
    mocks.invoke.mockReset().mockResolvedValue(undefined)
    mocks.unlisten.mockReset()
    mocks.handlers.length = 0
    mocks.listen.mockReset().mockImplementation(async (_name: string, handler: Handler) => {
      mocks.handlers.push(handler)
      return mocks.unlisten
    })
  })

  it('open 把地址、取整后的矩形与可见性交给 browser_view_open', async () => {
    const port = createTauriBrowserView()
    await port.open('canvas', {
      url: 'https://dribbble.com/',
      bounds: { x: 10.4, y: 20.6, width: 300.2, height: 199.5 },
    })
    expect(mocks.invoke).toHaveBeenCalledWith('browser_view_open', {
      id: 'canvas',
      url: 'https://dribbble.com/',
      bounds: { x: 10, y: 21, width: 301, height: 199 },
      visible: true,
    })
  })

  it('导航类命令名与参数名和 Rust 侧一致', async () => {
    const port = createTauriBrowserView()
    await port.navigate('canvas', 'https://huaban.com/')
    await port.back('canvas')
    await port.forward('canvas')
    await port.reload('canvas')
    await port.stop('canvas')
    await port.setBounds('canvas', { x: 0, y: 0, width: 10, height: 10 })
    await port.show('canvas')
    await port.hide('canvas')
    await port.close('canvas')
    expect(mocks.invoke.mock.calls.map((call) => call[0])).toEqual([
      'browser_view_navigate',
      'browser_view_back',
      'browser_view_forward',
      'browser_view_reload',
      'browser_view_stop',
      'browser_view_set_bounds',
      'browser_view_show',
      'browser_view_hide',
      'browser_view_close',
    ])
    expect(mocks.invoke.mock.calls[0]![1]).toEqual({ id: 'canvas', url: 'https://huaban.com/' })
  })

  it('非法视图 id 在前端就拒绝，不发命令', async () => {
    const port = createTauriBrowserView()
    await expect(port.show('../main')).rejects.toThrow('无效的浏览器视图 id')
    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  it('subscribe 只转发本视图的事件，并能退订', async () => {
    const port = createTauriBrowserView()
    const seen: unknown[] = []
    const off = port.subscribe('canvas', (event) => seen.push(event))
    expect(mocks.listen).toHaveBeenCalledWith(BROWSER_VIEW_EVENT, expect.any(Function))
    await Promise.resolve()
    const emit = mocks.handlers[0]!
    emit({ payload: { id: 'agent', kind: 'title', title: 'x' } })
    emit({ payload: { id: 'canvas', kind: 'loadStarted', url: 'https://a.com/' } })
    emit({ payload: { id: 'canvas', kind: 'title', title: 'A' } })
    emit({ payload: { id: 'canvas', kind: 'blocked', url: 'file:///x' } })
    expect(seen).toEqual([
      { kind: 'loadStarted', url: 'https://a.com/' },
      { kind: 'title', title: 'A' },
    ])
    off()
    expect(mocks.unlisten).toHaveBeenCalled()
  })

  it('退订早于 listen 落地时，落地后立刻解绑', async () => {
    let resolve: (fn: () => void) => void = () => undefined
    mocks.listen.mockImplementationOnce(() => new Promise((r) => { resolve = r }))
    const port = createTauriBrowserView()
    const off = port.subscribe('canvas', () => undefined)
    off()
    resolve(mocks.unlisten)
    await Promise.resolve()
    await Promise.resolve()
    expect(mocks.unlisten).toHaveBeenCalledTimes(1)
  })

  it('toBrowserViewEvent 丢掉缺地址或不认识的事件', () => {
    expect(toBrowserViewEvent({ id: 'canvas', kind: 'loadFinished' })).toBeNull()
    expect(toBrowserViewEvent({ id: 'canvas', kind: 'whatever', url: 'https://a.com/' })).toBeNull()
    expect(toBrowserViewEvent({ id: 'canvas', kind: 'loadFinished', url: 'https://a.com/' }))
      .toEqual({ kind: 'loadFinished', url: 'https://a.com/' })
  })
})
