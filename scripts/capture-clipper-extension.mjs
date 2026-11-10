import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const extensionRoot = resolve(root, 'browser-extension/qinghua-clipper')
const popupUrl = pathToFileURL(resolve(extensionRoot, 'popup.html')).href
const output = resolve(root, '.playwright-verify/clipper-extension')
const executablePath = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
].find((candidate) => candidate && existsSync(candidate))

if (!executablePath) {
  throw new Error('Chrome executable not found; set CHROME_PATH')
}

await mkdir(output, { recursive: true })
const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--no-proxy-server'],
})
const report = []

try {
  report.push(await capture({
    name: 'light-connected',
    theme: 'light',
    config: {
      endpoint: 'http://127.0.0.1:53684/clip',
      token: 'extension-demo-token',
    },
    tab: {
      title: 'Natural inflatable brand campaign references',
      url: 'https://example.com/inspiration/long-title-for-layout',
    },
    fetchMode: 'online',
    clickClip: true,
  }))
  report.push(await capture({
    name: 'dark-first-run',
    theme: 'dark',
    config: {
      endpoint: 'http://127.0.0.1:53684/clip',
      token: '',
    },
    tab: {
      title: 'Editorial packaging moodboard',
      url: 'https://example.com/moodboard',
    },
    fetchMode: 'offline',
  }))
  report.push(await captureDropTarget('light-drag-target', 'light'))
  report.push(await captureDropTarget('dark-drag-target', 'dark'))
  report.push(await capture({
    name: 'light-invalid-page',
    theme: 'light',
    config: {
      endpoint: 'http://127.0.0.1:53684/clip',
      token: 'extension-demo-token',
    },
    tab: {
      title: 'Extensions',
      url: 'chrome://extensions',
    },
    fetchMode: 'online',
  }))
  report.push(await capture({
    name: 'dark-offline',
    theme: 'dark',
    config: {
      endpoint: 'http://127.0.0.1:53684/clip',
      token: 'extension-demo-token',
    },
    tab: {
      title: 'Offline reference page',
      url: 'https://example.com/offline',
    },
    fetchMode: 'offline',
  }))
  await writeFile(
    resolve(output, 'report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  )
  console.log(`extension evidence: ${resolve(output, 'report.json')}`)
} finally {
  await browser.close()
}

async function capture({ name, theme, config, tab, fetchMode, clickClip = false }) {
  const context = await browser.newContext({
    viewport: { width: 380, height: 720 },
    colorScheme: theme,
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.addInitScript(({ initialConfig, initialTab, mode }) => {
    const store = { ...initialConfig }
    globalThis.chrome = {
      storage: {
        local: {
          get: async (defaults) => ({ ...defaults, ...store }),
          set: async (values) => Object.assign(store, values),
        },
      },
      tabs: {
        query: async () => [initialTab],
      },
    }
    globalThis.fetch = async (input) => {
      const url = String(input)
      if (mode === 'offline') throw new TypeError('Failed to fetch')
      if (url.endsWith('/health')) {
        return new Response('{"ok":true}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response('{"ok":true}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
  }, {
    initialConfig: config,
    initialTab: tab,
    mode: fetchMode,
  })
  await page.goto(popupUrl, { waitUntil: 'load' })
  await page.locator('#status').waitFor({ timeout: 5_000 })
  await page.waitForFunction(
    () => document.querySelector('#status-dot')?.dataset.state !== 'checking',
    { timeout: 5_000 },
  ).catch(() => undefined)
  if (clickClip) {
    await page.locator('#clip').click()
    await page.locator('#last-result').waitFor({ state: 'visible', timeout: 5_000 })
  }
  await page.screenshot({
    path: resolve(output, `${name}.png`),
    fullPage: true,
  })
  const metrics = await page.evaluate(() => ({
    status: document.querySelector('#status')?.textContent?.trim() ?? '',
    dotState: document.querySelector('#status-dot')?.dataset.state ?? '',
    pageInvalid: document.querySelector('#page-card')?.dataset.invalid ?? 'false',
    settingsOpen: document.querySelector('#settings')?.open ?? false,
    clipDisabled: document.querySelector('#clip')?.disabled ?? true,
    dragDisabled: document.querySelector('#drag')?.disabled ?? true,
    lastResult: document.querySelector('#last-result')?.textContent?.trim() ?? '',
    width: document.documentElement.scrollWidth,
    height: document.documentElement.scrollHeight,
    overflowX:
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  }))
  await context.close()
  return { name, theme, errors, ...metrics }
}

async function captureDropTarget(name, theme) {
  const context = await browser.newContext({
    viewport: { width: 720, height: 520 },
    colorScheme: theme,
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  const html = `<!doctype html>
    <style>
      body { margin: 0; min-height: 100vh; background: #eceee7; color: #171814; font: 14px/1.4 system-ui, sans-serif; }
      main { display: grid; gap: 16px; padding: 28px; max-width: 520px; }
      h1 { margin: 0; font-size: 20px; }
      .card { overflow: hidden; border-radius: 8px; background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
      img { display: block; width: 100%; height: 240px; object-fit: cover; }
    </style>
    <main>
      <h1>Billfish-style drag collection</h1>
      <section class="card">
        <img id="source-image" alt="Reference"
          src="data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='480'%3E%3Crect width='800' height='480' fill='%23bfd0c3'/%3E%3Ccircle cx='250' cy='210' r='110' fill='%23d9a36c'/%3E%3Crect x='420' y='90' width='250' height='300' rx='28' fill='%23527b69'/%3E%3C/svg%3E" />
      </section>
    </main>`
  await context.route('https://example.com/reference', (route) => {
    return route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: html,
    })
  })
  await page.goto('https://example.com/reference', {
    waitUntil: 'domcontentloaded',
  })
  await page.evaluate(() => {
    globalThis.__qinghuaMessages = []
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: {
        runtime: {
          sendMessage: async (message) => {
            globalThis.__qinghuaMessages.push(message)
            return { ok: true }
          },
        },
      },
    })
  })
  await page.addScriptTag({
    path: resolve(extensionRoot, 'drop-target.js'),
  })
  await page.locator('[data-qinghua-drop-target]').waitFor({ timeout: 5_000 })
  await page.evaluate(() => {
    const image = document.querySelector('#source-image')
    const host = document.querySelector('[data-qinghua-drop-target]')
    const dataTransfer = new DataTransfer()
    dataTransfer.setData('text/uri-list', 'https://cdn.example.com/dragged.webp')
    image.dispatchEvent(new DragEvent('dragstart', {
      bubbles: true,
      cancelable: true,
      dataTransfer,
    }))
    host.dispatchEvent(new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      composed: true,
      dataTransfer,
    }))
  })
  await page.waitForFunction(
    () => document.querySelector('[data-qinghua-drop-target]')
      ?.getAttribute('data-qinghua-drop-status') === '已收藏到「我的素材 → 轻画插件」',
    { timeout: 5_000 },
  )
  await page.screenshot({
    path: resolve(output, `${name}.png`),
  })
  const metrics = await page.evaluate(() => {
    const host = document.querySelector('[data-qinghua-drop-target]')
    const messages = globalThis.__qinghuaMessages ?? []
    return {
      ready: host?.getAttribute('data-qinghua-drop-ready') === 'true',
      status: host?.getAttribute('data-qinghua-drop-status') ?? '',
      error: host?.getAttribute('data-qinghua-drop-error') === 'true',
      messages,
      overflowX:
        document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    }
  })
  await context.close()
  return { name, theme, errors, ...metrics }
}
