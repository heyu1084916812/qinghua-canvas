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
async function mediaFixtures(browser) {
  const page = await browser.newPage({ viewport: { width: 800, height: 900 } })
  await page.setContent(`<!doctype html><style>
    body { margin: 0; background: #d8e3df; }
    div { border: 8px solid #48675f; box-sizing: border-box; }
    #square { width: 320px; height: 320px; background: #b9c9a8; }
    #tall { width: 240px; height: 420px; background: #a8c8bb; }
    #wide { width: 480px; height: 220px; background: #c4b48c; }
  </style><div id="square"></div><div id="tall"></div><div id="wide"></div>`)
  const square = await page.locator('#square').screenshot()
  const tall = await page.locator('#tall').screenshot()
  const wide = await page.locator('#wide').screenshot()
  await page.close()
  return { square, tall, wide }
}

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
const fixtures = await mediaFixtures(browser)
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
          try {
            await route.fulfill({
              status: 502,
              headers: {
                'content-type': 'application/json',
                'access-control-allow-origin': pageOrigin,
              },
              body: JSON.stringify({ ok: false, error: String(error) }),
            })
          } catch (fallbackError) {
            if (!String(fallbackError).includes('Route is already handled')) throw fallbackError
          }
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
    await page.locator('[data-my-assets-source="reference"]').click()
    await page.locator('[data-my-assets-reference-file]').setInputFiles([
      {
        name: 'square-reference.png',
        mimeType: 'image/png',
        buffer: fixtures.square,
      },
      {
        name: 'tall-reference.png',
        mimeType: 'image/png',
        buffer: fixtures.tall,
      },
      {
        name: 'wide-reference.png',
        mimeType: 'image/png',
        buffer: fixtures.wide,
      },
    ])
    await page.waitForFunction(
      () => document.querySelectorAll('[data-my-assets-reference]').length >= 3,
      { timeout: 20_000 },
    ).catch(() => {})
    const referenceQueryResponse = await fetch(`${STORE}/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ table: 'referenceItems', filter: {}, includePayload: false }),
    })
    const referenceRows = (await referenceQueryResponse.json()).rows ?? []
    const previewReference = referenceRows
      .filter((row) => typeof row.assetHash === 'string' && row.assetHash)
      .sort((left, right) => Number(right.createdAt ?? 0) - Number(left.createdAt ?? 0))[0]
    if (!previewReference) throw new Error('reference fixture asset missing')
    const previewHash = previewReference.assetHash
    const kitId = 'ui-seven-anbel-kit'
    const kitTime = 1_700_000_000_000
    const kitRows = [{
      id: kitId,
      kind: 'brand',
      name: 'Anbel',
      description: '自然有机风品牌套件',
      currentVersion: 1,
      createdAt: kitTime,
      updatedAt: kitTime,
    }]
    const kitVersionRows = [{
      id: `${kitId}:v1`,
      kitId,
      version: 1,
      guide: '自然有机、轻盈、干净的品牌视觉。',
      facts: [],
      assetHashes: [previewHash],
      resources: [{ hash: previewHash, role: 'logo', name: 'Anbel 标志' }],
      colors: [{ id: 'brand-green', name: '主色', value: '#8fc466' }],
      fonts: [{ id: 'abeezee', name: 'ABeeZee', detail: 'Regular' }],
      createdAt: kitTime,
    }]
    for (const [table, rows] of [
      ['contextKits', kitRows],
      ['contextKitVersions', kitVersionRows],
    ]) {
      const seeded = await fetch(`${STORE}/bulkPut`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ table, rows }),
      })
      if (!seeded.ok) throw new Error(`${table} seed failed: HTTP ${seeded.status}`)
    }
    await page.locator('[data-my-assets-close]').click()
    await page.locator('[data-canvas-my-assets]').click()
    await page.locator('[data-my-assets-drawer]').waitFor({ timeout: 10_000 })
    await page.locator('[data-my-assets-source="reference"]').click()
    await page.locator('[data-my-assets-kit-folder]').waitFor({ timeout: 10_000 })
    await page.waitForFunction(
      () => document.querySelectorAll('[data-my-assets-reference]').length >= 3,
      { timeout: 15_000 },
    )
    await page.waitForFunction(
      () => {
        const image = document.querySelector('[data-my-assets-kit-folder] img')
        return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0
      },
      { timeout: 15_000 },
    )
    const referenceCards = await page.locator('[data-my-assets-reference]').count()
    const referenceFolders = await page.locator('[data-my-assets-kit-folder]').count()
    const referenceUpload = await page.locator('[data-my-assets-reference-upload]').count()
    const referenceAgentActions = await page.locator('[data-my-assets-reference-agent]').count()
    const referenceLayout = await page.evaluate(() => {
      const grid = document.querySelector('[data-masonry-scope="my-assets-reference"]')
      const cards = [...document.querySelectorAll('[data-my-assets-reference]')]
      const rects = cards.map((card) => card.getBoundingClientRect())
      const media = cards.map((card) => card.querySelector('img, video'))
      const mediaRects = media.map((item) => item?.getBoundingClientRect())
      const lefts = [...new Set(rects.map((rect) => Math.round(rect.left)))]
      const tops = [...new Set(rects.map((rect) => Math.round(rect.top)))]
      const gridRect = grid?.getBoundingClientRect()
      return {
        referenceGridPresent: Boolean(grid),
        referenceColumns: lefts.length,
        referenceStaggered: tops.length > 1,
        referenceWidths: [...new Set(rects.map((rect) => Math.round(rect.width)))],
        referenceCardHeights: rects.map((rect) => Math.round(rect.height)),
        referenceMediaLoaded: media.every(
          (item) => item instanceof HTMLImageElement && item.complete && item.naturalWidth > 0,
        ),
        referenceMediaRatios: mediaRects.map((rect) =>
          rect && rect.height > 0 ? Number((rect.width / rect.height).toFixed(2)) : -1,
        ),
        referenceGridClientWidth: grid?.clientWidth ?? -1,
        referenceGridScrollWidth: grid?.scrollWidth ?? -1,
        referenceGridLeft: gridRect?.left ?? -1,
        referenceGridRight: gridRect?.right ?? -1,
        referenceCardRightmost: Math.max(...rects.map((rect) => rect.right)),
        referenceGridOverflowX: grid
          ? grid.scrollWidth > grid.clientWidth + 1
          : true,
      }
    })
    await page.screenshot({ path: path.join(out, `${file}-canvas-reference.png`) })
    await page.locator('[data-my-assets-reference]').first().hover()
    await page.waitForTimeout(180)
    const referenceQuickAddVisible = await page.locator('[data-my-assets-reference-agent]').first().evaluate(
      (button) => getComputedStyle(button).opacity === '1',
    )
    await page.screenshot({ path: path.join(out, `${file}-canvas-reference-hover.png`) })
    await page.locator('[data-my-assets-kit-folder]').first().hover()
    await page.waitForTimeout(180)
    const referenceFolderOpenVisible = await page.locator('[data-my-assets-kit-folder]').first().evaluate(
      (folder) => {
        const open = folder.querySelector('[class*="kitFolderOpen"]')
        return Boolean(open) && getComputedStyle(open).opacity === '1'
      },
    )
    const referenceFolderImageLoaded = await page.locator('[data-my-assets-kit-folder] img').first().evaluate(
      (image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0,
    )
    await page.screenshot({ path: path.join(out, `${file}-canvas-reference-folder-hover.png`) })
    await page.locator('[data-my-assets-kit-folder] button').first().click()
    await page.locator('[data-reference-kit-panel]').waitFor({ timeout: 10_000 })
    const referenceKitItems = await page.locator('[data-reference-kit-item]').count()
    const referenceKitImageItems = await page.locator('[data-reference-kit-item="image"]').count()
    await page.screenshot({ path: path.join(out, `${file}-canvas-reference-kit.png`) })
    await page.locator('[data-reference-kit-filter]').click()
    await page.locator('[data-reference-kit-filter-panel]').waitFor({ timeout: 5_000 })
    await page.locator('[data-reference-kit-filter-kind="color"]').uncheck()
    await page.locator('[data-reference-kit-filter-kind="font"]').uncheck()
    const referenceKitFilteredItems = await page.locator('[data-reference-kit-item]').count()
    await page.screenshot({ path: path.join(out, `${file}-canvas-reference-kit-filter.png`) })
    await page.locator('[data-reference-kit-back]').click()
    await page.locator('[data-reference-kit-panel]').waitFor({ state: 'detached', timeout: 5_000 })
    const referenceNodesBeforeDrop = await page.locator('[data-node-id]').count()
    await page.locator('[data-my-assets-reference-drag]').first().dragTo(
      page.locator('[data-canvas-surface]'),
      { targetPosition: { x: 400, y: 300 } },
    )
    await page.waitForFunction(
      (before) => document.querySelectorAll('[data-node-id]').length > before,
      referenceNodesBeforeDrop,
      { timeout: 15_000 },
    )
    const referenceNodesAfterDrop = await page.locator('[data-node-id]').count()
    const referenceDroppedTitle =
      (await page.locator('[data-node-id]').last().textContent({ timeout: 5_000 })) ?? ''
    await page.screenshot({ path: path.join(out, `${file}-canvas-reference-dropped.png`) })
    await page.waitForTimeout(2_200)
    await page.locator('[data-my-assets-reference-open]').first().dblclick()
    await page.locator('[data-reference-lightbox]').waitFor({ timeout: 15_000 })
    await page.locator('[data-reference-lightbox-media]').hover()
    await page.waitForTimeout(250)
    const referenceLightbox = await page.evaluate(() => {
      const lightbox = document.querySelector('[data-reference-lightbox]')
      const media = lightbox?.querySelector('[data-reference-lightbox-media] img, [data-reference-lightbox-media] video')
      const info = lightbox?.querySelector('[data-reference-lightbox-info]')
      const thumbs = lightbox?.querySelector('[data-reference-lightbox-thumbs]')
      const infoRect = info?.getBoundingClientRect()
      const mediaRect = media?.getBoundingClientRect()
      const thumbsRect = thumbs?.getBoundingClientRect()
      return {
        referenceLightboxOpen: Boolean(lightbox),
        referenceLightboxTitle:
          lightbox?.querySelector('[data-reference-lightbox-title]')?.textContent?.trim() ?? '',
        referenceLightboxInfo: Boolean(info),
        referenceLightboxThumbs:
          lightbox?.querySelectorAll('[data-reference-lightbox-thumb]').length ?? 0,
        referenceLightboxActions:
          lightbox?.querySelectorAll('[data-reference-lightbox-add-canvas], [data-reference-lightbox-add-agent]').length ?? 0,
        referenceLightboxMediaLoaded:
          media instanceof HTMLImageElement
            ? media.complete && media.naturalWidth > 0
            : media instanceof HTMLVideoElement
              ? media.readyState >= 1
              : false,
        referenceLightboxInfoInside:
          Boolean(infoRect) &&
          infoRect.left >= -1 &&
          infoRect.right <= window.innerWidth + 1,
        referenceLightboxMediaInside:
          Boolean(mediaRect) &&
          mediaRect.left >= -1 &&
          mediaRect.right <= window.innerWidth + 1 &&
          mediaRect.top >= -1 &&
          mediaRect.bottom <= window.innerHeight + 1,
        referenceLightboxOverflowX:
          Boolean(lightbox) && lightbox.scrollWidth > lightbox.clientWidth + 1,
        referenceThumbCenterDelta:
          mediaRect && thumbsRect
            ? Math.abs(
                (mediaRect.left + mediaRect.right) / 2 -
                (thumbsRect.left + thumbsRect.right) / 2,
              )
            : -1,
        referenceLightboxFocus:
          document.activeElement?.hasAttribute('data-reference-lightbox-close') ?? false,
      }
    })
    await page.screenshot({ path: path.join(out, `${file}-canvas-reference-lightbox.png`) })
    const referenceLightboxTitleBeforeNext = referenceLightbox.referenceLightboxTitle
    await page.locator('[data-reference-lightbox-next]').click()
    await page.waitForFunction(
      (before) =>
        document.querySelector('[data-reference-lightbox-title]')?.textContent?.trim() !== before,
      referenceLightboxTitleBeforeNext,
      { timeout: 5_000 },
    )
    const referenceLightboxTitleAfterNext =
      (await page.locator('[data-reference-lightbox-title]').textContent({ timeout: 5_000 }))?.trim() ?? ''
    await page.locator('[data-reference-lightbox-thumb]').last().click()
    await page.waitForFunction(
      (before) =>
        document.querySelector('[data-reference-lightbox-title]')?.textContent?.trim() !== before,
      referenceLightboxTitleAfterNext,
      { timeout: 5_000 },
    )
    const referenceLightboxTitleAfterThumb =
      (await page.locator('[data-reference-lightbox-title]').textContent({ timeout: 5_000 }))?.trim() ?? ''
    const referenceLightboxActiveThumbs =
      await page.locator('[data-reference-lightbox-thumb][aria-pressed="true"]').count()
    const referenceNodesBeforeLightboxAdd = await page.locator('[data-node-id]').count()
    await page.locator('[data-reference-lightbox-add-canvas]').click()
    await page.waitForFunction(
      (before) => document.querySelectorAll('[data-node-id]').length > before,
      referenceNodesBeforeLightboxAdd,
      { timeout: 15_000 },
    )
    const referenceNodesAfterLightboxAdd = await page.locator('[data-node-id]').count()
    const referenceLightboxAddStatus =
      (await page.locator('[data-reference-lightbox-info] [role="status"]').textContent({ timeout: 5_000 }))?.trim() ?? ''
    await page.screenshot({ path: path.join(out, `${file}-canvas-reference-lightbox-action.png`) })
    await page.keyboard.press('Escape')
    await page.locator('[data-reference-lightbox]').waitFor({ state: 'detached', timeout: 10_000 })
    const referenceLightboxClosed =
      (await page.locator('[data-reference-lightbox]').count()) === 0
    const referenceLightboxFocusReturned = await page.evaluate(
      () => document.activeElement?.hasAttribute('data-my-assets-reference-open') ?? false,
    )
    await page.locator('[data-my-assets-reference-open]').first().dblclick()
    await page.locator('[data-reference-lightbox]').waitFor({ timeout: 15_000 })
    await page.locator('[data-reference-lightbox-add-agent]').click()
    await page.locator('[data-agent-panel]').waitFor({ timeout: 15_000 })
    await page.locator('[data-agent-composer] [data-mention-kind="reference"]').waitFor({ timeout: 15_000 })
    const referenceChipMounted = await page.locator('[data-agent-composer] [data-mention-kind="reference"]').count()
    const referenceLightboxClosedByAgent =
      (await page.locator('[data-reference-lightbox]').count()) === 0
    await page.screenshot({ path: path.join(out, `${file}-canvas-reference-agent.png`) })
    await page.locator('[data-my-assets-source="assets"]').click()
    await page.screenshot({ path: path.join(out, `${file}-canvas-kits.png`) })
    report.push({
      variant,
      surface: 'canvasKits',
      drawer,
      sourceTabs,
      assetKinds,
      pinterestMounted,
      referenceCards,
      referenceFolders,
      referenceUpload,
      referenceAgentActions,
      referenceFolderOpenVisible,
      referenceFolderImageLoaded,
      referenceKitItems,
      referenceKitImageItems,
      referenceKitFilteredItems,
      referenceChipMounted,
      referenceQuickAddVisible,
      referenceLightboxOpen: referenceLightbox.referenceLightboxOpen,
      referenceLightboxTitle: referenceLightbox.referenceLightboxTitle,
      referenceLightboxTitleAfterNext,
      referenceLightboxTitleAfterThumb,
      referenceLightboxActiveThumbs,
      referenceLightboxInfo: referenceLightbox.referenceLightboxInfo,
      referenceLightboxThumbs: referenceLightbox.referenceLightboxThumbs,
      referenceLightboxActions: referenceLightbox.referenceLightboxActions,
      referenceLightboxMediaLoaded: referenceLightbox.referenceLightboxMediaLoaded,
      referenceLightboxInfoInside: referenceLightbox.referenceLightboxInfoInside,
      referenceLightboxMediaInside: referenceLightbox.referenceLightboxMediaInside,
      referenceLightboxOverflowX: referenceLightbox.referenceLightboxOverflowX,
      referenceThumbCenterDelta: referenceLightbox.referenceThumbCenterDelta,
      referenceLightboxFocus: referenceLightbox.referenceLightboxFocus,
      referenceLightboxFocusReturned,
      referenceLightboxAddStatus,
      referenceLightboxClosed,
      referenceLightboxClosedByAgent,
      referenceNodesBeforeDrop,
      referenceNodesAfterDrop,
      referenceDroppedTitle,
      referenceNodesBeforeLightboxAdd,
      referenceNodesAfterLightboxAdd,
      ...referenceLayout,
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
