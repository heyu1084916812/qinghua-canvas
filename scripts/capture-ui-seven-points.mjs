#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const ROOT = path.resolve(import.meta.dirname, '..')
const UI_PORT = Number(process.env.QH_UI_PORT ?? 1420)
const STORE_PORT = Number(process.env.QH_UI_STORE_PORT ?? 18821)
const BASE = process.env.QH_UI_BASE ?? `http://127.0.0.1:${UI_PORT}`
const STORE = process.env.QH_UI_STORE ?? `http://127.0.0.1:${STORE_PORT}`
const phase = process.argv.includes('--after') ? 'after' : 'before'
const out = path.join(ROOT, '.playwright-verify', `ui-seven-${phase}`)
fs.mkdirSync(out, { recursive: true })
const storeData = path.join(out, 'store')
fs.mkdirSync(storeData, { recursive: true })

const variants = [
  { width: 1440, height: 900, theme: 'dark' },
  { width: 1440, height: 900, theme: 'light' },
  { width: 1024, height: 700, theme: 'dark' },
  { width: 1024, height: 700, theme: 'light' },
]

const pageErrors = (page) => {
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error.message)))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  return errors
}

async function openSettings(page, id) {
  await page.evaluate((section) => window.__QINGHUA_OPEN_SETTINGS__?.(section), id)
  await page.locator('[data-global-settings]').waitFor({ timeout: 10_000 })
  return page.locator('[data-settings-section-body]')
}

async function geometry(page) {
  return page.evaluate(() => {
    const doc = document.documentElement
    const body = document.querySelector('[data-settings-section-body]')
    if (!body) return { horizontalOverflow: doc.scrollWidth > doc.clientWidth + 1 }
    const rect = body.getBoundingClientRect()
    const children = [...body.querySelectorAll('*')]
    return {
      horizontalOverflow: doc.scrollWidth > doc.clientWidth + 1,
      bodyOverflowX: body.scrollWidth > body.clientWidth + 1,
      childrenOutsideX: children.filter((child) => {
        const box = child.getBoundingClientRect()
        return box.width > 0 && (box.left < rect.left - 1 || box.right > rect.right + 1)
      }).length,
      scrollHeight: body.scrollHeight,
      clientHeight: body.clientHeight,
    }
  })
}

const ownedProcesses = []
const useExternalServices = Boolean(process.env.QH_UI_BASE || process.env.QH_UI_STORE)
const stopOwned = () => {
  for (const child of ownedProcesses.reverse()) {
    if (!child.killed && child.exitCode === null) child.kill()
  }
}
const waitForUrl = async (url, timeoutMs = 30_000) => {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      /* wait for the local service */
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`local service did not start: ${url}`)
}

if (!useExternalServices) {
const storeExe = path.join(
  ROOT,
  'shared-store',
  'target',
  'debug',
  process.platform === 'win32' ? 'qinghua-store.exe' : 'qinghua-store',
)
if (!fs.existsSync(storeExe)) {
  const built = spawnSync('cargo', ['build', '--manifest-path', 'shared-store/Cargo.toml'], {
    cwd: ROOT,
    stdio: 'inherit',
  })
  if (built.status !== 0) process.exit(built.status ?? 1)
}
const storeProcess = spawn(storeExe, [
  '--data-dir',
  storeData,
  '--backend',
  'v1',
  '--port',
  String(STORE_PORT),
], { cwd: ROOT, stdio: 'ignore' })
ownedProcesses.push(storeProcess)

const viteEntry = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js')
const viteProcess = spawn(process.execPath, [
  viteEntry,
  '--host',
  '127.0.0.1',
  '--port',
  String(UI_PORT),
  '--strictPort',
], {
  cwd: ROOT,
  stdio: 'ignore',
  env: { ...process.env, QINGHUA_SHARED_STORE_PORT: String(STORE_PORT) },
})
ownedProcesses.push(viteProcess)
process.on('exit', stopOwned)
process.on('SIGINT', () => {
  stopOwned()
  process.exit(130)
})
try {
  await waitForUrl(`${STORE}/health`)
  await waitForUrl(BASE)
} catch (error) {
    stopOwned()
    throw error
  }
}

const browser = await chromium.launch({ channel: 'chrome', args: ['--no-proxy-server'] })
const report = []
const snapshots = Array.from({ length: 12 }, (_, index) => ({
  id: `ui-seven-seed-${phase}-${index}`,
  projectId: 'ui-seven-seed-project',
  createdAt: 1_700_000_000_000 + index * 60_000,
  name: '未命名项目',
  nodeCount: 3,
  nodes: [{ id: 'n1' }],
  edges: [],
  runRecords: [],
}))
const seedResponse = await fetch(`${STORE}/bulkPut`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ table: 'snapshots', rows: snapshots }),
})
if (!seedResponse.ok) throw new Error(`snapshot seed failed: HTTP ${seedResponse.status}`)
try {
  for (const variant of variants) {
    const context = await browser.newContext({
      viewport: { width: variant.width, height: variant.height },
      deviceScaleFactor: 1,
    })
    const storeTarget = new URL(STORE)
    for (const origin of new Set(['http://127.0.0.1:18765', storeTarget.origin])) {
      await context.route(`${origin}/**`, async (route) => {
        const request = route.request()
        const requestHeaders = { ...request.headers() }
        const targetUrl = new URL(request.url())
        targetUrl.protocol = storeTarget.protocol
        targetUrl.hostname = storeTarget.hostname
        targetUrl.port = storeTarget.port
        const pageOrigin = new URL(BASE).origin
        try {
          const response = await route.fetch({
            url: targetUrl.toString(),
            headers: { ...requestHeaders, origin: 'http://127.0.0.1:1420' },
          })
          await route.fulfill({
            response,
            headers: {
              ...response.headers(),
              'access-control-allow-origin': pageOrigin,
              'access-control-allow-credentials': 'true',
            },
          })
        } catch (error) {
          await route.fulfill({
            status: 502,
            headers: {
              'content-type': 'application/json',
              'access-control-allow-origin': pageOrigin,
            },
            body: JSON.stringify({ ok: false, error: String(error) }),
          })
        }
      })
    }
    await context.addInitScript((storeBase) => {
      Object.assign(window, { __QINGHUA_SHARED_STORE_PORT__: Number(new URL(storeBase).port) })
    }, STORE)
    const page = await context.newPage()
    const errors = pageErrors(page)
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.evaluate((theme) => {
      localStorage.setItem('flow:onboarded', '1')
      localStorage.setItem('flow:canvasGuideDismissed', '1')
      localStorage.setItem('flow:theme', theme)
      document.documentElement.dataset.theme = theme
    }, variant.theme)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('[data-home-page]').waitFor({ timeout: 20_000 }).catch(() => {})

    const file = `${variant.width}-${variant.theme}`
    await page.screenshot({ path: path.join(out, `${file}-home.png`) })
    await page.locator('[data-home-new]').click()
    const choiceOptions = await page.locator('[data-new-project-choice]').count().catch(() => 0)
    const homeMetrics = await geometry(page)
    await page.screenshot({ path: path.join(out, `${file}-new-project.png`) })
    report.push({ variant, surface: 'newProject', choiceOptions, ...homeMetrics, errors: [...errors] })
    await page.locator('[data-new-project-choice-close]').click().catch(() => {})

    await openSettings(page, 'agent')
    await page.waitForTimeout(250)
    const agentMetrics = await geometry(page)
    await page.screenshot({ path: path.join(out, `${file}-agent.png`) })
    report.push({ variant, surface: 'agent', agentMetrics, errors: [...errors] })

    await openSettings(page, 'snapshots')
    await page.locator('[data-snapshots-panel]').waitFor({ timeout: 10_000 })
    await page.waitForFunction(
      () => document.querySelectorAll('[data-snapshot-item]').length > 0,
      { timeout: 10_000 },
    )
    const snapshotRows = await page.locator('[data-snapshot-item]').count().catch(() => 0)
    await page.screenshot({ path: path.join(out, `${file}-snapshots.png`) })
    report.push({ variant, surface: 'snapshots', snapshotRows, ...(await geometry(page)), errors: [...errors] })

    await openSettings(page, 'cli')
    await page.waitForTimeout(250)
    const cliMetrics = await geometry(page)
    await page.screenshot({ path: path.join(out, `${file}-cli.png`) })
    report.push({ variant, surface: 'cli', ...cliMetrics, errors: [...errors] })

    await openSettings(page, 'canvasMcp')
    await page.waitForTimeout(250)
    const mcpTabCount = await page.locator('[data-global-settings-tab="canvasMcp"]').count()
    const mcpMetrics = await geometry(page)
    await page.screenshot({ path: path.join(out, `${file}-canvas-mcp.png`) })
    report.push({ variant, surface: 'canvasMcp', mcpTabCount, ...mcpMetrics, errors: [...errors] })

    await openSettings(page, 'defaults')
    await page.waitForTimeout(250)
    const defaultNavCount = await page.locator('[data-global-settings-tab="defaults"]').count()
    const defaultsMetrics = await geometry(page)
    await page.screenshot({ path: path.join(out, `${file}-defaults.png`) })
    report.push({ variant, surface: 'defaults', defaultNavCount, ...defaultsMetrics, errors: [...errors] })

    await page.keyboard.press('Escape')
    await page.goto(BASE, { waitUntil: 'domcontentloaded' })
    await page.locator('[data-home-page]').waitFor({ timeout: 10_000 })
    await page.locator('[data-home-new]').click({ timeout: 10_000 }).catch(() => {})
    await page.locator('[data-new-project-choice="canvas"]').click({ timeout: 10_000 })
    await page.waitForURL(/\/canvas\//, { timeout: 20_000 })
    await page.locator('[data-canvas-my-assets]').waitFor({ timeout: 10_000 })
    const kitsButtons = await page.locator('[data-canvas-my-assets]').count()
    const defaultsButtons = await page.locator('[data-canvas-defaults]').count()
    const stageWidthClosed = await page.locator('[data-canvas-stage]').evaluate((node) => node.getBoundingClientRect().width)
    await page.screenshot({ path: path.join(out, `${file}-canvas.png`) })
    report.push({ variant, surface: 'canvas', kitsButtons, defaultsButtons, stageWidthClosed, ...(await geometry(page)), errors: [...errors] })
    await page.locator('[data-canvas-my-assets]').click()
    await page.locator('[data-my-assets-drawer]').waitFor({ timeout: 10_000 })
    const drawer = await page.locator('[data-my-assets-drawer]').count()
    const sourceTabs = await page.locator('[data-my-assets-source]').count()
    const assetKinds = await page.locator('[data-my-assets-kind]').count()
    const drawerGeometry = await page.evaluate(() => {
      const root = document.querySelector('[data-my-assets-drawer]')
      const panel = root
      const stage = document.querySelector('[data-canvas-stage]')
      const tabs = [...(root?.querySelectorAll('[data-my-assets-source]') ?? [])]
      const body = root?.querySelector('[data-my-assets-body]')
      const panelRect = panel?.getBoundingClientRect()
      return {
        drawerLeft: panelRect?.left ?? -1,
        drawerWidth: panelRect?.width ?? 0,
        stageWidthOpen: stage?.getBoundingClientRect().width ?? -1,
        tabCount: tabs.length,
        tabSelected: tabs.filter((tab) => tab.getAttribute('aria-selected') === 'true').length,
        pageOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        bodyOverflowY: body ? body.scrollHeight > body.clientHeight + 1 : false,
        childrenOutsideX: [...(panel?.querySelectorAll('*') ?? [])].filter((child) => {
          const box = child.getBoundingClientRect()
          return box.width > 0 && panelRect && (box.left < panelRect.left - 1 || box.right > panelRect.right + 1)
        }).length,
      }
    })
    await page.locator('[data-my-assets-source="pinterest"]').click()
    await page.locator('[data-pinterest-panel]').waitFor({ timeout: 10_000 }).catch(() => {})
    const pinterestMounted = await page.locator('[data-pinterest-panel]').count()
    await page.locator('[data-my-assets-source="assets"]').click()
    await page.screenshot({ path: path.join(out, `${file}-canvas-kits.png`) })
    report.push({
      variant,
      surface: 'canvasKits',
      drawer,
      sourceTabs,
      assetKinds,
      pinterestMounted,
      stageWidthClosed,
      ...drawerGeometry,
      canvasWidthDelta: stageWidthClosed - drawerGeometry.stageWidthOpen,
      errors: [...errors],
    })

    await page.keyboard.press('Escape').catch(() => {})
    await context.close()
  }
} finally {
  await browser.close()
  stopOwned()
}
fs.writeFileSync(path.join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(`${phase} evidence: ${path.join(out, 'report.json')}`)
