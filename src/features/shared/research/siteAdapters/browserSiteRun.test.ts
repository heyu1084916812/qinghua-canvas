import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentBrowserEvent, AgentBrowserPort } from '../../../../platform/agentBrowser'
import { browserSiteSpec, type BrowserSiteSpec } from './browserSites'
import { resetBrowserSiteState, runBrowserSite } from './browserSiteRun'
import type { PageSnapshot } from './pageSnapshot'
import { classifyPageWall } from './pageWall'
import type { BrowserSiteContext, BrowserWallRequest } from './types'

function spec(id: BrowserSiteSpec['id']): BrowserSiteSpec {
  return browserSiteSpec(id)!
}

function snap(partial: Partial<PageSnapshot> & { images?: PageSnapshot['images'] }): string {
  return JSON.stringify({
    url: partial.url ?? 'https://dribbble.com/search/tea',
    title: partial.title ?? 'Dribbble',
    images: partial.images ?? [],
    signals: { passwordField: false, challengeMarkers: [], gatedCount: 0, textLength: 100, ...partial.signals },
  })
}

const SHOT = {
  src: 'https://cdn.dribbble.com/userupload/1/file/original-a.jpg?resize=800x600',
  width: 400,
  height: 300,
  alt: 'Tea box',
  link: 'https://dribbble.com/shots/1-Tea-box',
  title: 'Tea box',
}
const CHALLENGE = snap({ title: '', signals: { passwordField: false, challengeMarkers: ['aws-waf'], gatedCount: 0, textLength: 10 } })
const LOGIN = snap({ url: 'https://dribbble.com/session/new', title: 'Sign in', signals: { passwordField: true, challengeMarkers: [], gatedCount: 0, textLength: 50 } })
const OK = snap({ images: [SHOT] })

function fakePort(loads: string[], snapshots: string[] = []) {
  const listeners = new Set<(event: AgentBrowserEvent) => void>()
  const calls: string[] = []
  const port: AgentBrowserPort = {
    load: vi.fn(async (id: string) => {
      calls.push(`load:${id}`)
      return loads.shift() ?? OK
    }),
    snapshot: vi.fn(async (id: string) => {
      calls.push(`snapshot:${id}`)
      return snapshots.shift() ?? OK
    }),
    show: vi.fn(async (id: string) => { calls.push(`show:${id}`) }),
    hide: vi.fn(async (id: string) => { calls.push(`hide:${id}`) }),
    close: vi.fn(async (id: string) => { calls.push(`close:${id}`) }),
    subscribe: (_id, listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  return { port, calls, fireClosed: () => listeners.forEach((fn) => fn({ kind: 'closed' })) }
}

const request = { query: 'tea', limit: 10, queryIndex: 0 }
const noSleep = async () => undefined

afterEach(() => resetBrowserSiteState())

describe('runBrowserSite：Agent 后台浏览器跑一个站', () => {
  it('正常页：打开 → 提取 → 关窗口；结果进调研候选结构', async () => {
    const { port, calls } = fakePort([OK])
    const outcome = await runBrowserSite(spec('dribbble'), { browser: port, sleep: noSleep }, request, new AbortController().signal)
    expect(outcome.status).toBe('ok')
    expect(outcome.items[0]).toMatchObject({ source: 'dribbble', url: SHOT.link, imageUrl: SHOT.src })
    expect(calls).toEqual(['load:dribbble', 'close:dribbble'])
    expect(vi.mocked(port.load).mock.calls[0]![1]).toBe('https://dribbble.com/search/tea')
    expect(vi.mocked(port.load).mock.calls[0]![2]).toContain('JSON.stringify')
  })

  it('人机验证先等自动放行：几秒后当前页重新提取就有结果，不打扰用户', async () => {
    const { port, calls } = fakePort([CHALLENGE], [CHALLENGE, OK])
    const resolveWall = vi.fn()
    const outcome = await runBrowserSite(spec('dribbble'), { browser: port, sleep: noSleep, resolveWall }, request, new AbortController().signal)
    expect(outcome.status).toBe('ok')
    expect(resolveWall).not.toHaveBeenCalled()
    expect(calls).toEqual(['load:dribbble', 'snapshot:dribbble', 'snapshot:dribbble', 'close:dribbble'])
  })

  it('一直被挡：亮出窗口请用户处理，点继续后隐藏窗口、重新打开并提取', async () => {
    const { port, calls } = fakePort([LOGIN, OK])
    const seen: BrowserWallRequest[] = []
    const context: BrowserSiteContext = {
      browser: port,
      sleep: noSleep,
      resolveWall: async (wall) => {
        seen.push(wall)
        return 'continue'
      },
    }
    const outcome = await runBrowserSite(spec('dribbble'), context, request, new AbortController().signal)
    expect(outcome.status).toBe('ok')
    expect(seen).toEqual([{ siteId: 'dribbble', label: 'Dribbble', kind: 'login', reason: '跳到了登录页', url: 'https://dribbble.com/search/tea' }])
    expect(calls).toEqual(['load:dribbble', 'show:dribbble', 'hide:dribbble', 'load:dribbble', 'close:dribbble'])
  })

  it('用户直接关掉亮出的窗口 = 继续', async () => {
    const { port, fireClosed } = fakePort([LOGIN, OK])
    const context: BrowserSiteContext = {
      browser: port,
      sleep: noSleep,
      resolveWall: (_wall, signal) => new Promise((resolve) => {
        setTimeout(fireClosed, 0)
        signal.addEventListener('abort', () => resolve('cancel'))
      }),
    }
    const outcome = await runBrowserSite(spec('dribbble'), context, request, new AbortController().signal)
    expect(outcome.status).toBe('ok')
  })

  it('取消 ⇒ needs-login，且本次运行期间不再为这个站弹提示', async () => {
    const { port } = fakePort([LOGIN, LOGIN])
    const resolveWall = vi.fn(async () => 'cancel' as const)
    const context = { browser: port, sleep: noSleep, resolveWall }
    const first = await runBrowserSite(spec('dribbble'), context, request, new AbortController().signal)
    expect(first).toMatchObject({ status: 'needs-login', items: [] })
    expect(first.failureText).toContain('需要登录')
    const second = await runBrowserSite(spec('dribbble'), context, request, new AbortController().signal)
    expect(second.status).toBe('needs-login')
    expect(resolveWall).toHaveBeenCalledTimes(1)
  })

  it('没有提示回调（不打扰用户）时验证页记 blocked', async () => {
    const { port } = fakePort([CHALLENGE], [CHALLENGE, CHALLENGE, CHALLENGE])
    const outcome = await runBrowserSite(spec('dribbble'), { browser: port, sleep: noSleep }, request, new AbortController().signal)
    expect(outcome.status).toBe('blocked')
    expect(outcome.failureText).toContain('人机验证')
  })

  it('Pinterest 未登录被挡、用户取消：needs-login 且不带被遮挡的 Pin 图（不能算「搜到了」）', async () => {
    const gated = snap({
      url: 'https://www.pinterest.com/search/pins/?q=tea',
      images: [{ src: 'https://i.pinimg.com/736x/aa/bb/cc/x.jpg', width: 236, height: 400, alt: 'Pin', link: '', title: '' }],
      signals: { passwordField: true, challengeMarkers: [], gatedCount: 12, textLength: 100 },
    })
    const { port } = fakePort([gated])
    const outcome = await runBrowserSite(spec('pinterest'), { browser: port, sleep: noSleep, resolveWall: async () => 'cancel' }, request, new AbortController().signal)
    expect(outcome).toMatchObject({ status: 'needs-login', items: [] })
  })

  it('每个站本次运行只提示一次：点了继续仍被挡 ⇒ 不再弹，下次检索也不弹', async () => {
    const { port, calls } = fakePort([LOGIN, LOGIN, LOGIN])
    const resolveWall = vi.fn(async () => 'continue' as const)
    const context = { browser: port, sleep: noSleep, resolveWall }
    const first = await runBrowserSite(spec('dribbble'), context, request, new AbortController().signal)
    expect(first).toMatchObject({ status: 'needs-login', items: [] })
    expect(calls).toEqual(['load:dribbble', 'show:dribbble', 'hide:dribbble', 'load:dribbble', 'close:dribbble'])
    const second = await runBrowserSite(spec('dribbble'), context, request, new AbortController().signal)
    expect(second.status).toBe('needs-login')
    expect(resolveWall).toHaveBeenCalledTimes(1)
  })

  it('打不开 ⇒ network；认不出 ⇒ unrecognized；都会关窗口', async () => {
    const broken = fakePort([])
    vi.mocked(broken.port.load).mockRejectedValueOnce(new Error('页面加载超时'))
    expect((await runBrowserSite(spec('thedieline'), { browser: broken.port }, request, new AbortController().signal)).status).toBe('network')
    expect(broken.calls).toContain('close:thedieline')
    const weird = fakePort(['<html>'])
    expect((await runBrowserSite(spec('thedieline'), { browser: weird.port }, request, new AbortController().signal)).status).toBe('unrecognized')
  })

  it('停止调研：等待中的提示被撤掉，停在登录墙上就记 needs-login', async () => {
    const { port } = fakePort([LOGIN])
    const controller = new AbortController()
    let promptSignal: AbortSignal | null = null
    const outcome = runBrowserSite(spec('dribbble'), {
      browser: port,
      sleep: noSleep,
      resolveWall: (_wall, signal) => {
        promptSignal = signal
        setTimeout(() => controller.abort(), 0)
        return new Promise((resolve) => signal.addEventListener('abort', () => resolve('cancel')))
      },
    }, request, controller.signal)
    expect(await outcome).toMatchObject({ status: 'needs-login', items: [] })
    expect(promptSignal!.aborted).toBe(true)
  })

  it('同一个站同一时刻只跑一份（窗口 id 固定）', async () => {
    const order: string[] = []
    let release: () => void = () => undefined
    const { port } = fakePort([])
    vi.mocked(port.load).mockImplementationOnce(async () => {
      order.push('first-start')
      await new Promise<void>((resolve) => { release = resolve })
      order.push('first-end')
      return OK
    }).mockImplementationOnce(async () => {
      order.push('second-start')
      return OK
    })
    const context = { browser: port, sleep: noSleep }
    const a = runBrowserSite(spec('dribbble'), context, request, new AbortController().signal)
    const b = runBrowserSite(spec('dribbble'), context, request, new AbortController().signal)
    await new Promise((resolve) => setTimeout(resolve, 0))
    release()
    await Promise.all([a, b])
    expect(order).toEqual(['first-start', 'first-end', 'second-start'])
  })
})

describe('classifyPageWall', () => {
  const base: PageSnapshot = { url: 'https://a.com/search?q=x', title: 'A', images: [], signals: { passwordField: false, challengeMarkers: [], gatedCount: 0, textLength: 10 } }
  it('有结果就不算墙（正常页也可能挂着验证脚本）', () => {
    expect(classifyPageWall({ ...base, signals: { ...base.signals, challengeMarkers: ['cloudflare-turnstile'] } }, { requestedUrl: base.url, itemCount: 3 }).kind).toBe('none')
  })
  it('Cloudflare 标题 / 跳登录页 / 空结果 + 密码框', () => {
    expect(classifyPageWall({ ...base, title: 'Just a moment...' }, { requestedUrl: base.url, itemCount: 0 }).kind).toBe('challenge')
    expect(classifyPageWall({ ...base, title: '请稍候…' }, { requestedUrl: base.url, itemCount: 0 }).kind).toBe('challenge')
    expect(classifyPageWall({ ...base, url: 'https://a.com/accounts/login/?next=/search' }, { requestedUrl: base.url, itemCount: 0 }).kind).toBe('login')
    expect(classifyPageWall({ ...base, signals: { ...base.signals, passwordField: true } }, { requestedUrl: base.url, itemCount: 0 }).kind).toBe('login')
    expect(classifyPageWall(base, { requestedUrl: base.url, itemCount: 0 }).kind).toBe('none')
  })
  it('页面只有「登录」链接（The Dieline 收藏按钮指向 /wp-login.php）不算登录墙', () => {
    expect(classifyPageWall(base, { requestedUrl: base.url, itemCount: 6 }).kind).toBe('none')
  })
})
