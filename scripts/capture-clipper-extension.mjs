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
    lastResult: document.querySelector('#last-result')?.textContent?.trim() ?? '',
    width: document.documentElement.scrollWidth,
    height: document.documentElement.scrollHeight,
    overflowX:
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  }))
  await context.close()
  return { name, theme, errors, ...metrics }
}
