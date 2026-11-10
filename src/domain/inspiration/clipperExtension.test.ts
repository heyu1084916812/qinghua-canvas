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
  it('uses one storage toggle with required HTTP/HTTPS page access', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('manifest.json', extensionRoot), 'utf8'),
    ) as {
      version: string
      manifest_version: number
      permissions: string[]
      host_permissions: string[]
      optional_host_permissions?: string[]
      background?: { service_worker?: string }
      commands?: Record<string, unknown>
    }

    expect(manifest.manifest_version).toBe(3)
    expect(manifest.version).toBe('0.4.3')
    expect(manifest.permissions).toEqual(['storage', 'scripting'])
    expect(manifest.host_permissions).toEqual([
      'http://127.0.0.1:53684/*',
      'http://*/*',
      'https://*/*',
    ])
    expect(manifest.optional_host_permissions).toBeUndefined()
    expect(manifest.background?.service_worker).toBe('background.js')
    expect(manifest.commands).toBeUndefined()
    expect(JSON.stringify(manifest)).not.toContain('<all_urls>')
  })

  it('keeps the popup to one drag switch and never reads cookies', () => {
    const popup = readFileSync(new URL('popup.html', extensionRoot), 'utf8')
    const popupScript = readFileSync(new URL('popup.js', extensionRoot), 'utf8')
    const popupStyle = readFileSync(new URL('popup.css', extensionRoot), 'utf8')
    const directImage = readFileSync(
      new URL('drop-target.js', extensionRoot),
      'utf8',
    )

    expect(popup).toContain('id="drag-mode"')
    expect(popup).toContain('role="switch"')
    expect(popup).toContain('id="status-dot"')
    expect(popup).not.toContain('id="version"')
    expect(popup).not.toContain('id="clip"')
    expect(popup).not.toContain('id="token"')
    expect(popup).not.toContain('id="settings"')
    expect(popupScript).not.toContain('getManifest')
    expect(popupScript).not.toContain("chrome.permissions.request")
    expect(popupScript).toContain("type: 'qinghua:set-drag-mode'")
    expect(popupScript).toContain('Only permissions specified in the manifest may be requested')
    expect(directImage).toContain("document.addEventListener('dragstart'")
    expect(directImage).toContain("host.addEventListener('drop'")
    expect(directImage).toContain('data-qinghua-drop-box')
    expect(directImage).toContain('qinghua:clip-image')
    expect(`${popupStyle}\n${directImage}`).not.toMatch(
      /#(?:2f6b4f|80bd99|e7f2eb|25372c|2b4333|3b7b5c)/i,
    )
    expect(`${popupScript}\n${directImage}`).not.toMatch(
      /document\.cookie|chrome\.cookies/,
    )
  })

  it('packages the background worker, drop target and icons', () => {
    const background = readFileSync(
      new URL('background.js', extensionRoot),
      'utf8',
    )

    expect(background).toContain("importScripts('shared.js')")
    expect(background).toContain('registerContentScripts')
    expect(background).toContain("files: ['drop-target.js']")
    expect(background).toContain("'qinghua:clip-image'")
    expect(background).not.toContain('chrome.permissions.request')
    expect(background).not.toContain('permissions.contains')
    expect(background).not.toContain('permissions.onRemoved')
    for (const size of [16, 32, 48, 128]) {
      expect(() =>
        readFileSync(new URL(`icons/${size}.png`, extensionRoot)),
      ).not.toThrow()
    }
  })

  it('keeps the local install helper on the automatic pairing path', () => {
    const installer = readFileSync(
      new URL('../../../scripts/install-clipper-local.ps1', import.meta.url),
      'utf8',
    )

    expect(installer).toContain('pair automatically')
    expect(installer).not.toContain('paste the local endpoint')
    expect(installer).not.toContain('pairing token')
  })

  it('bundles the extension source into the desktop application resources', () => {
    const config = JSON.parse(
      readFileSync(
        new URL('../../../src-tauri/tauri.conf.json', import.meta.url),
        'utf8',
      ),
    ) as { bundle: { resources: Record<string, string> } }

    expect(config.bundle.resources['../browser-extension/qinghua-clipper/'])
      .toBe('resources/qinghua-clipper/')
  })

  it('keeps release probes capable of copying nested extension resources', () => {
    const releaseProbe = readFileSync(
      new URL('../../../scripts/check-release-shell.mjs', import.meta.url),
      'utf8',
    )
    const updateProbe = readFileSync(
      new URL('../../../scripts/check-clipper-update-shell.mjs', import.meta.url),
      'utf8',
    )

    expect(releaseProbe).toContain('function copyDirectory(source, destination)')
    expect(releaseProbe).toContain('copyDirectory(RESOURCE_SRC, resourceTarget)')
    expect(updateProbe).toContain("invoke('clipper_receiver_info')")
    expect(updateProbe).toContain("invoke('clipper_extension_update')")
    expect(updateProbe).toContain('QINGHUA_CLIPPER_MANAGED_ROOT')
  })

  it('normalizes loopback input and posts the image without extra data', async () => {
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
    expect(api.normalizePageUrl('chrome://extensions')).toBe('')

    await api.clipPage({
      endpoint: 'http://127.0.0.1:53684/clip',
      token: 'secret-token',
      url: 'https://example.com/idea',
      title: '  Long   page title  ',
      imageUrl: 'https://cdn.example.com/idea.webp',
    })

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
      imageUrl: 'https://cdn.example.com/idea.webp',
    })
  })

  it('auto-pairs by reading the local extension-only token endpoint', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, token: 'paired-token' }),
    }))
    const api = loadSharedApi(fetchMock, '0.4.3')

    await expect(api.pairReceiver(
      'http://127.0.0.1:53684/clip',
    )).resolves.toBe('paired-token')
    const [url, request] = fetchMock.mock.calls[0] as unknown as [
      string,
      { method: string; headers: Record<string, string>; body: string },
    ]
    expect(url).toBe('http://127.0.0.1:53684/pair')
    expect(request.method).toBe('POST')
    expect(request.headers['X-Qinghua-Clipper-Pair']).toBe('1')
    expect(JSON.parse(request.body)).toEqual({ version: '0.4.3' })
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
    })).rejects.toMatchObject({ code: 'auth' })

    const offline = loadSharedApi(vi.fn(async () => {
      throw new TypeError('fetch failed')
    }))
    await expect(offline.checkReceiver(
      'http://127.0.0.1:53684/clip',
    )).rejects.toMatchObject({ code: 'offline' })
  })

  it('registers the persistent drag script and injects it into open tabs', async () => {
    const harness = loadBackgroundApi(vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    })))
    const response = await message(harness, {
      type: 'qinghua:set-drag-mode',
      enabled: true,
    })

    expect(response).toEqual({ ok: true })
    expect(harness.chrome.scripting.registerContentScripts).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'qinghua-drag-collector',
        matches: ['http://*/*', 'https://*/*'],
        js: ['drop-target.js'],
        persistAcrossSessions: true,
      }),
    ])
    expect(harness.chrome.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 7 },
      files: ['drop-target.js'],
    })
  })

  it('auto-pairs the receiver when the popup connects', async () => {
    const fetchMock = vi.fn(async (input: string) => ({
      ok: true,
      status: 200,
      json: async () => String(input).endsWith('/pair')
        ? { ok: true, token: 'paired-token' }
        : { ok: true },
    }))
    const harness = loadBackgroundApi(fetchMock)
    const response = await message(harness, { type: 'qinghua:connect' })

    expect(response).toMatchObject({ ok: true, paired: true })
    expect(harness.storage.token).toBe('paired-token')
  })
})

function message(
  harness: ReturnType<typeof loadBackgroundApi>,
  value: { type: string; enabled?: boolean },
): Promise<{ ok: boolean; error?: string; paired?: boolean }> {
  return new Promise((resolve) => {
    const keepChannel = harness.messageListener(
      value,
      { tab: { id: 7, url: 'https://example.com/', title: 'Example' } },
      (response) => resolve(response as {
        ok: boolean
        error?: string
        paired?: boolean
      }),
    )
    expect(keepChannel).toBe(true)
  })
}

function loadSharedApi(
  fetchMock: ReturnType<typeof vi.fn>,
  manifestVersion = '',
) {
  const source = readFileSync(new URL('shared.js', extensionRoot), 'utf8')
  const context = {
    AbortController,
    URL,
    clearTimeout,
    chrome: {
      runtime: {
        getManifest: () => ({ version: manifestVersion }),
      },
    },
    fetch: fetchMock,
    setTimeout,
  } as Record<string, unknown>
  context.globalThis = context
  runInNewContext(source, context)
  return context.QinghuaClipper as {
    normalizeEndpoint(value: string): string
    normalizePageUrl(value: string): string
    checkReceiver(endpoint: string): Promise<boolean>
    pairReceiver(endpoint: string): Promise<string>
    clipPage(input: {
      endpoint: string
      token: string
      url: string
      title: string
      imageUrl?: string
    }): Promise<unknown>
  }
}

function loadBackgroundApi(fetchMock: ReturnType<typeof vi.fn>) {
  let messageListener: (
    message: { type?: string; enabled?: boolean },
    sender: { tab?: { id?: number; url?: string; title?: string } },
    respond: (value: unknown) => void,
  ) => boolean = () => false
  const storage = {
    endpoint: 'http://127.0.0.1:53684/clip',
    token: '',
    dragMode: false,
  }
  const chrome = {
    runtime: {
      getManifest: () => ({ version: '0.4.3' }),
      onInstalled: { addListener: vi.fn() },
      onStartup: { addListener: vi.fn() },
      onMessage: {
        addListener: vi.fn((listener) => {
          messageListener = listener
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
        id: 7,
        title: 'Example inspiration',
        url: 'https://example.com/reference',
      }]),
      sendMessage: vi.fn(async () => ({ ok: true })),
    },
    scripting: {
      executeScript: vi.fn(async () => [{ result: true }]),
      getRegisteredContentScripts: vi.fn(async () => []),
      registerContentScripts: vi.fn(async () => undefined),
      unregisterContentScripts: vi.fn(async () => undefined),
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
  return { chrome, storage, messageListener }
}
