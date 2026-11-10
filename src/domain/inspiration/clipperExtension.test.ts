// @ts-expect-error -- 项目刻意不引入 @types/node；扩展静态取证只属于测试。
import { readFileSync } from 'node:fs'
// @ts-expect-error -- 项目刻意不引入 @types/node；VM 只用于扩展脚本行为取证。
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const extensionRoot = new URL(
  '../../../browser-extension/qinghua-clipper/',
  import.meta.url,
)

describe('qinghua clipper extension contract', () => {
  it('requests only the active tab, local storage and the loopback receiver', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('manifest.json', extensionRoot), 'utf8'),
    ) as {
      manifest_version: number
      permissions: string[]
      host_permissions: string[]
      background?: { service_worker?: string }
      commands?: Record<string, unknown>
    }

    expect(manifest.manifest_version).toBe(3)
    expect(manifest.permissions).toEqual(['activeTab', 'storage', 'contextMenus'])
    expect(manifest.host_permissions).toEqual([
      'http://127.0.0.1:53684/*',
    ])
    expect(manifest.background?.service_worker).toBe('background.js')
    expect(manifest.commands?.['clip-active-page']).toBeTruthy()
    expect(JSON.stringify(manifest)).not.toContain('<all_urls>')
  })

  it('sends the URL and token without reading browser cookies', () => {
    const source = readFileSync(new URL('popup.js', extensionRoot), 'utf8')
    const shared = readFileSync(new URL('shared.js', extensionRoot), 'utf8')

    expect(source).toContain('QinghuaClipper')
    expect(shared).toContain('X-Qinghua-Clipper-Token')
    expect(shared).toContain('http://127.0.0.1:53684/clip')
    expect(`${source}\n${shared}`).not.toMatch(/document\.cookie|chrome\.cookies/)
  })

  it('keeps background, popup and icon entry points packaged', () => {
    const background = readFileSync(
      new URL('background.js', extensionRoot),
      'utf8',
    )
    const popup = readFileSync(new URL('popup.html', extensionRoot), 'utf8')
    const popupScript = readFileSync(new URL('popup.js', extensionRoot), 'utf8')

    expect(background).toContain("importScripts('shared.js')")
    expect(background).toContain("contexts: ['page', 'link']")
    expect(background).toContain("chrome.commands.onCommand")
    expect(popupScript).toContain('dataset.state')
    expect(popup).toContain('id="status-dot"')
    expect(popup).toContain('id="retry"')
    expect(popup).toContain('id="settings"')
    expect(popup).toContain('id="last-result"')
    for (const size of [16, 32, 48, 128]) {
      expect(() =>
        readFileSync(new URL(`icons/${size}.png`, extensionRoot)),
      ).not.toThrow()
    }
  })

  it('normalizes loopback input and posts exactly URL, title and token', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    }))
    const api = loadSharedApi(fetchMock)

    expect(api.normalizeEndpoint('http://127.0.0.1:53684/clip')).toBe(
      'http://127.0.0.1:53684/clip',
    )
    expect(api.normalizeEndpoint('http://localhost:53684/clip')).toBe('')
    expect(api.normalizeEndpoint('https://127.0.0.1:53684/clip')).toBe('')
    expect(api.normalizePageUrl('chrome://extensions')).toBe('')

    await api.clipPage({
      endpoint: 'http://127.0.0.1:53684/clip',
      token: 'secret-token',
      url: 'https://example.com/idea',
      title: '  Long   page title  ',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, request] = fetchMock.mock.calls[0] as unknown as [
      string,
      {
        method: string
        headers: Record<string, string>
        body: string
      },
    ]
    expect(url).toBe('http://127.0.0.1:53684/clip')
    expect(request.method).toBe('POST')
    expect(request.headers['X-Qinghua-Clipper-Token']).toBe('secret-token')
    expect(JSON.parse(request.body)).toEqual({
      url: 'https://example.com/idea',
      title: 'Long page title',
    })
  })

  it('surfaces authentication and health failures with recovery copy', async () => {
    const unauthorized = loadSharedApi(vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ ok: false }),
    })))
    await expect(unauthorized.clipPage({
      endpoint: 'http://127.0.0.1:53684/clip',
      token: 'bad-token',
      url: 'https://example.com/',
      title: 'Example',
    })).rejects.toMatchObject({
      code: 'auth',
      message: expect.stringContaining('配对令牌无效'),
    })

    const offline = loadSharedApi(vi.fn(async () => {
      throw new TypeError('fetch failed')
    }))
    await expect(offline.checkReceiver(
      'http://127.0.0.1:53684/clip',
    )).rejects.toMatchObject({
      code: 'offline',
      message: '无法连接轻画桌面端',
    })
  })

  it('wires the keyboard command to the same authenticated local clip path', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    }))
    const harness = loadBackgroundApi(fetchMock)

    harness.commandListener('clip-active-page')

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(harness.chrome.action.setBadgeText).toHaveBeenCalledWith({
      text: '✓',
    })
    expect(harness.chrome.tabs.query).toHaveBeenCalledWith({
      active: true,
      currentWindow: true,
    })
  })
})

function loadSharedApi(fetchMock: ReturnType<typeof vi.fn>) {
  const source = readFileSync(new URL('shared.js', extensionRoot), 'utf8')
  const context = {
    AbortController,
    URL,
    clearTimeout,
    fetch: fetchMock,
    setTimeout,
  } as Record<string, unknown>
  context.globalThis = context
  runInNewContext(source, context)
  return context.QinghuaClipper as {
    normalizeEndpoint(value: string): string
    normalizePageUrl(value: string): string
    checkReceiver(endpoint: string): Promise<boolean>
    clipPage(input: {
      endpoint: string
      token: string
      url: string
      title: string
    }): Promise<unknown>
  }
}

function loadBackgroundApi(fetchMock: ReturnType<typeof vi.fn>) {
  let commandListener: (command: string) => void = () => undefined
  const storage = {
    endpoint: 'http://127.0.0.1:53684/clip',
    token: 'secret-token',
  }
  const chrome = {
    runtime: {
      onInstalled: { addListener: vi.fn() },
    },
    contextMenus: {
      removeAll: vi.fn(async () => undefined),
      create: vi.fn(),
      onClicked: { addListener: vi.fn() },
    },
    commands: {
      onCommand: {
        addListener: vi.fn((listener: (command: string) => void) => {
          commandListener = listener
        }),
      },
    },
    action: {
      setBadgeBackgroundColor: vi.fn(),
      setBadgeText: vi.fn(),
      setTitle: vi.fn(),
    },
    storage: {
      local: {
        get: vi.fn(async (defaults) => ({ ...defaults, ...storage })),
        set: vi.fn(async (values) => Object.assign(storage, values)),
      },
    },
    tabs: {
      query: vi.fn(async () => [{
        title: 'Example inspiration',
        url: 'https://example.com/reference',
      }]),
    },
  }
  const context = {
    AbortController,
    URL,
    clearTimeout: vi.fn(),
    setTimeout: vi.fn(() => 1),
    fetch: fetchMock,
    chrome,
  } as Record<string, unknown>
  context.globalThis = context
  context.importScripts = (...names: string[]) => {
    for (const name of names) {
      runInNewContext(
        readFileSync(new URL(name, extensionRoot), 'utf8'),
        context,
      )
    }
  }
  runInNewContext(
    readFileSync(new URL('background.js', extensionRoot), 'utf8'),
    context,
  )
  return { chrome, commandListener }
}
