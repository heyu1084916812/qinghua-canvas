import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const root = path.resolve(import.meta.dirname, '..')
const output = path.join(root, '.playwright-verify', 'clipper-multiselect')
const dataDir = path.join(output, 'store')
const storePort = 18823
const storeUrl = `http://127.0.0.1:${storePort}`
const appUrl = 'http://127.0.0.1:1420'
const image = fs.readFileSync(path.join(root, 'scripts', 'fixtures', 'mediapipe-portrait.jpg'))

if (!dataDir.startsWith(`${output}${path.sep}`)) throw new Error('unsafe store path')
fs.rmSync(output, { recursive: true, force: true })
fs.mkdirSync(dataDir, { recursive: true })

const storeExe = path.join(
  root,
  'shared-store',
  'target',
  'debug',
  process.platform === 'win32' ? 'qinghua-store.exe' : 'qinghua-store',
)
if (!fs.existsSync(storeExe)) {
  const built = spawnSync('cargo', ['build', '--manifest-path', 'shared-store/Cargo.toml'], {
    cwd: root,
    stdio: 'inherit',
  })
  if (built.status !== 0) process.exit(built.status ?? 1)
}

const store = spawn(storeExe, [
  '--data-dir', dataDir,
  '--backend', 'v1',
  '--port', String(storePort),
], { cwd: root, stdio: 'ignore' })

async function waitFor(url, timeout = 20_000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    try {
      if ((await fetch(url)).ok) return
    } catch {
      // Wait for the isolated store.
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`service did not start: ${url}`)
}

let browser
try {
  await waitFor(`${storeUrl}/health`)
  await waitFor(appUrl)
  await fetch(`${storeUrl}/bulkPut`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      table: 'presets',
      rows: [{
        id: 'clipper:collection:v1',
        items: [1, 2, 3].map((index) => ({
          id: `clip-${index}`,
          source: 'web',
          title: `美工部参考 ${index}`,
          url: `https://example.com/reference-${index}`,
          imageUrl: `https://assets.example.com/reference-${index}.jpg`,
          collectedAt: 1_700_000_000_000 + index,
          category: '未分类',
        })),
        categories: ['灵感'],
        updatedAt: Date.now(),
      }],
    }),
  })

  browser = await chromium.launch({ channel: 'chrome', args: ['--no-proxy-server'] })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await routeStore(context)
  await context.route('https://assets.example.com/**', (route) => route.fulfill({
    status: 200,
    contentType: 'image/jpeg',
    body: image,
  }))
  await context.addInitScript((port) => {
    Object.assign(window, { __QINGHUA_SHARED_STORE_PORT__: port })
  }, storePort)

  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.goto(appUrl, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => {
    localStorage.setItem('flow:onboarded', '1')
    localStorage.setItem('flow:canvasGuideDismissed', '1')
    localStorage.setItem('flow:theme', 'dark')
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('[data-home-page]').waitFor({ timeout: 20_000 }).catch(async (error) => {
    console.error(JSON.stringify({
      body: (await page.locator('body').innerText().catch(() => '')).slice(0, 1000),
      html: (await page.content().catch(() => '')).slice(0, 1000),
      errors,
    }, null, 2))
    throw error
  })
  await page.locator('[data-home-new]').click()
  await page.locator('[data-new-project-choice="canvas"]').click()
  await page.waitForURL(/\/canvas\//, { timeout: 20_000 })
  await page.locator('[data-canvas-my-assets]').waitFor({ timeout: 10_000 })
  const openTrace = await traceOpen(
    page,
    '[data-canvas-my-assets]',
    '[data-my-assets-slot][data-my-assets-open="true"]',
  )
  await page.locator('[data-my-assets-drawer]').waitFor({ timeout: 10_000 })
  await page.locator('[data-my-assets-source="clipper"]').click()
  await page.locator('[data-clipper-item]').first().waitFor({ timeout: 10_000 })

  await page.locator('[data-clipper-create-category]').click()
  await page.locator('[data-clipper-category-input]').fill('美工部')
  await page.locator('[data-clipper-create-panel] button[type="submit"]').click()
  await page.locator('[data-clipper-filter="category:美工部"]').waitFor({ timeout: 5_000 })

  await page.locator('[data-clipper-selection-toggle]').click()
  await page.locator('[data-clipper-selection-bar]').waitFor({ timeout: 5_000 })
  await page.locator('[data-clipper-item]').nth(0).locator('button').first().click()
  await page.locator('[data-clipper-item]').nth(1).locator('button').first().click()
  const selectedTwoText = (await page.locator('[data-clipper-selection-bar]').innerText()).trim()
  await page.screenshot({ path: path.join(output, 'selected-two.png') })
  await page.locator('[data-clipper-selection-move]').click()
  await page.screenshot({ path: path.join(output, 'move-menu.png') })
  await page.locator('[data-clipper-move-category="美工部"]').click()
  await page.locator('[data-clipper-selection-bar]').waitFor({ state: 'detached', timeout: 5_000 })
  await page.locator('[data-clipper-filter="category:美工部"]').click()
  await page.waitForFunction(
    () => document.querySelectorAll('[data-clipper-item]').length === 2,
    { timeout: 5_000 },
  )
  const movedItems = await page.locator('[data-clipper-item]').count()
  await page.screenshot({ path: path.join(output, 'moved-category.png') })

  await page.locator('[data-clipper-selection-toggle]').click()
  await page.locator('[data-clipper-item]').first().locator('button').first().click()
  await page.locator('[data-clipper-selection-delete]').click()
  await page.waitForFunction(
    () => document.querySelectorAll('[data-clipper-item]').length === 1,
    { timeout: 5_000 },
  )
  const remainingItems = await page.locator('[data-clipper-item]').count()
  await page.locator('[data-clipper-filter="all"]').click()

  const closeTrace = await traceClose(
    page,
    '[data-my-assets-close]',
    '[data-my-assets-slot]',
    '[data-my-assets-drawer]',
  )
  await page.locator('[data-canvas-agent]').click()
  await page.locator('[data-agent-panel]').waitFor({ state: 'visible', timeout: 15_000 })
  const agentCloseTrace = await traceClose(
    page,
    '[data-agent-close]',
    '[data-agent-shell-panel]',
    '[data-agent-panel]',
  )

  fs.writeFileSync(path.join(output, 'report.json'), `${JSON.stringify({
    selectedTwoText,
    movedItems,
    remainingItems,
    openTrace,
    closeTrace,
    agentCloseTrace,
    errors,
  }, null, 2)}\n`)
  console.log(path.join(output, 'report.json'))
} finally {
  await browser?.close()
  store.kill()
}

async function routeStore(context) {
  for (const origin of ['http://127.0.0.1:18765', storeUrl]) {
    await context.route(`${origin}/**`, async (route) => {
      const request = route.request()
      const target = new URL(request.url())
      const storeTarget = new URL(storeUrl)
      target.protocol = storeTarget.protocol
      target.hostname = storeTarget.hostname
      target.port = storeTarget.port
      try {
        const headers = { ...request.headers(), origin: appUrl }
        delete headers.host
        delete headers['content-length']
        const response = await fetch(target, {
          method: request.method(),
          headers,
          body: request.postDataBuffer() ?? undefined,
        })
        await route.fulfill({
          status: response.status,
          headers: {
            ...Object.fromEntries(response.headers),
            'access-control-allow-origin': appUrl,
            'access-control-allow-credentials': 'true',
          },
          body: Buffer.from(await response.arrayBuffer()),
        })
      } catch (error) {
        await route.fulfill({
          status: 502,
          headers: {
            'content-type': 'application/json',
            'access-control-allow-origin': appUrl,
          },
          body: JSON.stringify({ ok: false, error: String(error) }),
        })
      }
    })
  }
}

async function traceClose(page, buttonSelector, targetSelector, mountSelector) {
  return page.evaluate(async ({
    buttonSelector: buttonId,
    targetSelector: targetId,
    mountSelector: mountedId,
  }) => {
    const button = document.querySelector(buttonId)
    if (!(button instanceof HTMLElement)) throw new Error('close button missing')
    const longTasks = []
    const observer = typeof PerformanceObserver === 'function'
      ? new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) longTasks.push(entry.duration)
        })
      : null
    try {
      observer?.observe({ entryTypes: ['longtask'] })
    } catch {
      // Long Task API is optional in the test browser.
    }
    const frames = []
    let start = 0
    let previous = 0
    let finished = false
    const sample = (now) => {
      if (previous) frames.push(Math.round((now - previous) * 10) / 10)
      previous = now
      const target = document.querySelector(targetId)
      if (target?.hasAttribute('hidden')) {
        finished = true
        return
      }
      requestAnimationFrame(sample)
    }
    button.addEventListener('click', () => {
      start = performance.now()
      previous = start
      requestAnimationFrame(sample)
    }, { capture: true, once: true })
    button.click()
    while (!finished) await new Promise((resolve) => requestAnimationFrame(resolve))
    observer?.disconnect()
    return {
      closeLatencyMs: Math.round((performance.now() - start) * 10) / 10,
      maxFrameGapMs: frames.length ? Math.max(...frames) : 0,
      framesOver25Ms: frames.filter((duration) => duration > 25).length,
      longTasks,
      panelStillMounted: Boolean(document.querySelector(mountedId)),
      targetHidden: document.querySelector(targetId)?.hasAttribute('hidden') ?? false,
    }
  }, { buttonSelector, targetSelector, mountSelector })
}

async function traceOpen(page, buttonSelector, targetSelector) {
  return page.evaluate(async ({ buttonSelector: buttonId, targetSelector: targetId }) => {
    const button = document.querySelector(buttonId)
    if (!(button instanceof HTMLElement)) throw new Error('open button missing')
    const frames = []
    let start = 0
    let previous = 0
    let finished = false
    const sample = (now) => {
      if (previous) frames.push(Math.round((now - previous) * 10) / 10)
      previous = now
      if (document.querySelector(targetId)) {
        finished = true
        return
      }
      requestAnimationFrame(sample)
    }
    button.addEventListener('click', () => {
      start = performance.now()
      previous = start
      requestAnimationFrame(sample)
    }, { capture: true, once: true })
    button.click()
    while (!finished) await new Promise((resolve) => requestAnimationFrame(resolve))
    return {
      openLatencyMs: Math.round((performance.now() - start) * 10) / 10,
      maxFrameGapMs: frames.length ? Math.max(...frames) : 0,
    }
  }, { buttonSelector, targetSelector })
}
