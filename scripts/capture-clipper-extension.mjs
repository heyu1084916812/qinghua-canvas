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
  report.push(await capturePopup({
    name: 'light-on',
    theme: 'light',
    dragMode: true,
    online: true,
  }))
  report.push(await capturePopup({
    name: 'dark-on',
    theme: 'dark',
    dragMode: true,
    online: true,
  }))
  report.push(await capturePopup({
    name: 'light-off',
    theme: 'light',
    dragMode: false,
    online: true,
  }))
  report.push(await capturePopup({
    name: 'dark-offline',
    theme: 'dark',
    dragMode: true,
    online: false,
  }))
  report.push(await captureDropTarget({
    name: 'light-lazy-image',
    theme: 'light',
    viewport: { width: 1440, height: 900 },
    variant: 'lazy',
  }))
  report.push(await captureDropTarget({
    name: 'dark-lazy-image',
    theme: 'dark',
    viewport: { width: 1440, height: 900 },
    variant: 'lazy',
  }))
  report.push(await captureDropTarget({
    name: 'light-responsive-image',
    theme: 'light',
    viewport: { width: 1024, height: 700 },
    variant: 'picture',
  }))
  report.push(await captureDropTarget({
    name: 'dark-background-image',
    theme: 'dark',
    viewport: { width: 1024, height: 700 },
    variant: 'background',
  }))
  report.push(await captureDropTarget({
    name: 'light-page-without-image',
    theme: 'light',
    viewport: { width: 1024, height: 700 },
    variant: 'page-only',
  }))
  report.push(await captureDropTarget({
    name: 'light-huaban-overlay-original',
    theme: 'light',
    viewport: { width: 1440, height: 900 },
    variant: 'huaban-card',
  }))
  await writeFile(
    resolve(output, 'report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  )
  console.log(`extension evidence: ${resolve(output, 'report.json')}`)
} finally {
  await browser.close()
}

async function capturePopup({ name, theme, dragMode, online }) {
  const context = await browser.newContext({
    viewport: { width: 300, height: 210 },
    colorScheme: theme,
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.addInitScript(({ initialDragMode, isOnline }) => {
    const store = { dragMode: initialDragMode }
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: {
        storage: {
          local: {
            get: async (defaults) => ({ ...defaults, ...store }),
            set: async (values) => Object.assign(store, values),
          },
        },
        runtime: {
          sendMessage: async (message) => {
            if (message?.type === 'qinghua:connect') {
              return isOnline
                ? { ok: true, paired: true }
                : { ok: false, error: '轻画未打开' }
            }
            if (message?.type === 'qinghua:set-drag-mode') {
              store.dragMode = Boolean(message.enabled)
              return { ok: true }
            }
            return { ok: true }
          },
        },
      },
    })
  }, {
    initialDragMode: dragMode,
    isOnline: online,
  })
  await page.goto(popupUrl, { waitUntil: 'load' })
  await page.waitForFunction(
    () => document.querySelector('#status-dot')?.dataset.state !== 'checking',
    { timeout: 5_000 },
  )
  await page.waitForTimeout(200)
  await page.screenshot({
    path: resolve(output, `${name}.png`),
    fullPage: true,
  })
  const metrics = await page.evaluate(() => {
    const toggle = document.querySelector('#drag-mode')
    const switchControl = toggle?.nextElementSibling
    return {
      status: document.querySelector('#status')?.textContent?.trim() ?? '',
      dotState: document.querySelector('#status-dot')?.dataset.state ?? '',
      dragMode: toggle?.checked ?? false,
      hint: document.querySelector('#hint')?.textContent?.trim() ?? '',
      switchBackground: switchControl
        ? getComputedStyle(switchControl).backgroundColor
        : '',
      switchThumbTransform: switchControl
        ? getComputedStyle(switchControl, '::after').transform
        : '',
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
      overflowX:
        document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    }
  })
  await context.close()
  return { name, theme, errors, ...metrics }
}

async function captureDropTarget({ name, theme, viewport, variant }) {
  const context = await browser.newContext({
    viewport,
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
      .background { display: block; width: 100%; height: 240px; background-size: cover; background-position: center; }
    </style>
    <main>
      <h1>Drag an image</h1>
      ${dropTargetFixture(variant)}
    </main>`
  await context.route('https://example.com/reference', (route) => {
    return route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: html,
    })
  })
  await context.route('https://cdn.example.com/**', (route) => route.fulfill({
    status: 200,
    contentType: 'image/png',
    body: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lYQ7WQAAAABJRU5ErkJggg==',
      'base64',
    ),
  }))
  await context.route('https://gd-hbimg.huaban.com/**', (route) => route.fulfill({
    status: 200,
    contentType: 'image/png',
    body: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lYQ7WQAAAABJRU5ErkJggg==',
      'base64',
    ),
  }))
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
          onMessage: {
            addListener: () => undefined,
            removeListener: () => undefined,
          },
        },
      },
    })
  })
  await page.addScriptTag({
    path: resolve(extensionRoot, 'drop-target.js'),
  })
  await page.locator('[data-qinghua-drop-target]').waitFor({
    state: 'attached',
    timeout: 5_000,
  })
  await page.evaluate(({ fixtureVariant }) => {
    const source = fixtureVariant === 'huaban-card'
      ? document.querySelector('[data-card-action]')
      : document.querySelector('#drag-source')
    const anchor = document.querySelector('#source-image') || document.querySelector('#drag-source')
    const bounds = anchor.getBoundingClientRect()
    const dataTransfer = new DataTransfer()
    dataTransfer.setData('text/uri-list', fixtureVariant === 'page-only'
      ? 'https://example.com/reference'
      : 'https://cdn.example.com/fallback.png')
    source.dispatchEvent(new DragEvent('dragstart', {
      bubbles: true,
      cancelable: true,
      dataTransfer,
      clientX: bounds.left + bounds.width / 2,
      clientY: bounds.top + bounds.height / 2,
    }))
  }, { fixtureVariant: variant })
  await page.waitForFunction(
    () => document.querySelector('[data-qinghua-drop-target]')
      ?.getAttribute('data-qinghua-drop-visible') === 'true',
    { timeout: 5_000 },
  )
  await page.waitForTimeout(150)
  await page.screenshot({ path: resolve(output, `${name}-open.png`) })
  await page.evaluate(({ fixtureVariant }) => {
    const host = document.querySelector('[data-qinghua-drop-target]')
    const dataTransfer = new DataTransfer()
    dataTransfer.setData('text/uri-list', fixtureVariant === 'lazy'
      ? 'https://cdn.example.com/placeholder.png'
      : fixtureVariant === 'page-only'
        ? 'https://example.com/reference'
        : 'https://cdn.example.com/fallback.png')
    host.dispatchEvent(new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      composed: true,
      dataTransfer,
    }))
  }, { fixtureVariant: variant })
  await page.waitForFunction(
    ({ fixtureVariant }) => {
      const host = document.querySelector('[data-qinghua-drop-target]')
      return fixtureVariant === 'page-only'
        ? host?.getAttribute('data-qinghua-drop-error') === 'true'
        : (globalThis.__qinghuaMessages?.length ?? 0) > 0
    },
    { fixtureVariant: variant },
    { timeout: 5_000 },
  )
  await page.waitForTimeout(100)
  await page.screenshot({ path: resolve(output, `${name}-saved.png`) })
  const metrics = await page.evaluate(() => {
    const host = document.querySelector('[data-qinghua-drop-target]')
    const messages = globalThis.__qinghuaMessages ?? []
    return {
      ready: host?.getAttribute('data-qinghua-drop-ready') === 'true',
      visible: host?.getAttribute('data-qinghua-drop-visible') === 'true',
      status: host?.getAttribute('data-qinghua-drop-status') ?? '',
      error: host?.getAttribute('data-qinghua-drop-error') === 'true',
      messages,
      selectedImageUrl: messages.at(-1)?.imageUrl ?? '',
      overflowX:
        document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    }
  })
  await context.close()
  const expectedImageUrl = {
    lazy: 'https://cdn.example.com/original.jpg',
    picture: 'https://cdn.example.com/large.webp',
    background: 'https://cdn.example.com/background.jpg',
    'huaban-card': 'https://gd-hbimg.huaban.com/huaban-original',
    'page-only': '',
  }[variant]
  const passed = variant === 'page-only'
    ? metrics.error && metrics.messages.length === 0
    : metrics.selectedImageUrl === expectedImageUrl
  if (!passed) {
    throw new Error(
      `${name}: expected ${expectedImageUrl || 'no message'}, got ${
        metrics.selectedImageUrl || metrics.status
      }`,
    )
  }
  return { name, theme, viewport, variant, expectedImageUrl, passed, errors, ...metrics }
}

function dropTargetFixture(variant) {
  if (variant === 'lazy') {
    return `<section class="card">
      <a id="drag-source" href="https://example.com/pin">
        <img id="source-image" alt="Huaban-style lazy image"
          src="https://cdn.example.com/placeholder.png"
          data-original="https://cdn.example.com/original.jpg" />
      </a>
    </section>`
  }
  if (variant === 'picture') {
    return `<section class="card">
      <picture id="drag-source">
        <source srcset="https://cdn.example.com/small.webp 480w, https://cdn.example.com/large.webp 1600w" />
        <img id="source-image" alt="Responsive image"
          src="https://cdn.example.com/fallback.png" />
      </picture>
    </section>`
  }
  if (variant === 'background') {
    return `<section class="card">
      <a id="drag-source" class="background"
        style="background-image:url('https://cdn.example.com/background.jpg')"
        href="https://example.com/background"></a>
    </section>`
  }
  if (variant === 'huaban-card') {
    return `<section id="drag-source" class="card" style="position:relative;min-height:300px">
      <img id="source-image" alt="花瓣采集灵感图"
        src="https://gd-hbimg.huaban.com/huaban-original_fw192webp"
        srcset="https://gd-hbimg.huaban.com/huaban-original_fw480webp 2x" />
      <button data-card-action type="button"
        style="position:absolute;left:12px;top:12px;width:52px;height:52px;border:0;padding:0;background:transparent">
        <img class="avatar" alt="用户头像" src="https://cdn.example.com/avatar.png"
          style="width:44px;height:44px;border-radius:50%" />
      </button>
    </section>`
  }
  return `<section class="card">
    <a id="drag-source" href="https://example.com/reference"
      style="display:block;height:240px;background:#dfe4da"></a>
  </section>`
}
