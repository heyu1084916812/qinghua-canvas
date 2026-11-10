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
const clipperUpdateOnly = process.env.QH_UI_CLIPPER_UPDATE_ONLY === '1'
const out = path.join(ROOT, '.playwright-verify', `ui-seven-${phase}`)
fs.mkdirSync(out, { recursive: true })
const storeData = path.join(out, 'store')
if (!storeData.startsWith(`${out}${path.sep}`)) {
  throw new Error(`unsafe store path: ${storeData}`)
}
fs.rmSync(storeData, { recursive: true, force: true })
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
    #portrait { width: 260px; height: 400px; background: #d6b99c; }
    #add { width: 280px; height: 180px; background: #b76e79; }
    #replace { width: 220px; height: 200px; background: #708090; }
  </style><div id="square"></div><div id="tall"></div><div id="wide"></div><div id="portrait"></div><div id="add"></div><div id="replace"></div>`)
  const square = await page.locator('#square').screenshot()
  const tall = await page.locator('#tall').screenshot()
  const wide = await page.locator('#wide').screenshot()
  const portrait = await page.locator('#portrait').screenshot()
  const add = await page.locator('#add').screenshot()
  const replace = await page.locator('#replace').screenshot()
  await page.close()
  return { square, tall, wide, portrait, add, replace }
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
const storeExe =
  process.env.QH_UI_STORE_EXE ??
  path.join(
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
  'v2',
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
    await context.route('https://example.com/qinghua-clip.png', (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: fixtures.square,
      })
    })
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
    for (const host of [
      'microsoftedge.microsoft.com',
      'chromewebstore.google.com',
    ]) {
      await context.route(`https://${host}/**`, (route) => {
        return route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: '<!doctype html><title>轻画 Clipper 安装页</title><main>extension store</main>',
        })
      })
    }
    await context.addInitScript((storeBase) => {
      Object.assign(window, { __QINGHUA_SHARED_STORE_PORT__: Number(new URL(storeBase).port) })
    }, STORE)
    await context.addInitScript(({ pngBase64 }) => {
      if (
        localStorage.getItem('qinghua:clipper-ui-probe') !== '1'
        || !location.pathname.startsWith('/canvas/')
      ) return
      const updateStatus = {
        loadedVersion: '0.4.2',
        bundledVersion: '0.4.4',
        needsUpdate: true,
        reloadRequired: false,
        stableDirectory: 'C:\\Users\\Administrator\\Documents\\QinghuaClipper\\extension',
      }
      let pending = [{
        id: 'clip-ui-probe-1',
        url: 'https://example.com/clipper-source',
        title: '娴忚鍣ㄦ敹钘忛獙璇佸浘',
        imageUrl: 'https://example.com/qinghua-clip.png',
        receivedAt: Date.now(),
      }]
      window.__clipperAckIds = []
      window.__qinghuaUiPngBase64 = pngBase64
      window.isTauri = true
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
        unregisterListener: async () => undefined,
      }
      let nextCallbackId = 1
      const callbacks = new Map()
      window.__TAURI_INTERNALS__ = {
        metadata: {
          currentWindow: { label: 'main' },
          currentWebview: { windowLabel: 'main', label: 'main' },
        },
        transformCallback: (callback) => {
          const id = nextCallbackId++
          callbacks.set(id, callback)
          return id
        },
        unregisterCallback: (id) => callbacks.delete(id),
        invoke: async (command, args) => {
          if (command === 'clipper_receiver_info') {
            return {
              running: true,
              endpoint: 'http://127.0.0.1:53684/clip',
              token: 'ui-probe-token',
              extension: updateStatus,
            }
          }
          if (command === 'clipper_pending_snapshot') return pending
          if (command === 'clipper_ack_pending') {
            const acknowledged = new Set(args?.ids ?? [])
            window.__clipperAckIds.push(...acknowledged)
            pending = pending.filter((clip) => !acknowledged.has(clip.id))
            return pending
          }
          if (command === 'fetch_text') {
            return {
              status: 200,
              headers: { 'content-type': 'image/png' },
              text: '',
              bodyBase64: window.__qinghuaUiPngBase64,
              finalUrl: args?.url,
            }
          }
          if (command === 'clipper_extension_update') {
            return {
              status: { ...updateStatus, needsUpdate: false, reloadRequired: true },
              updated: true,
              openedExtensionPage: true,
            }
          }
          if (command === 'storage_startup_state') return { kind: 'ready' }
          if (command === 'plugin:app|version') return '0.1.17'
          if (command === 'plugin:event|listen') return 1
          if (command.startsWith('plugin:event|unlisten')) return null
          if (command.startsWith('plugin:window|')) return false
          throw new Error(`unexpected Tauri command: ${command}`)
        },
      }
    }, { pngBase64: fixtures.square.toString('base64') })
    const page = await context.newPage()
    const errors = pageErrors(page)
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60_000 })
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

    await page.evaluate(() => {
      localStorage.setItem('qinghua:clipper-ui-probe', '1')
    })
    await page.keyboard.press('Escape')
    await page.goto(BASE, { waitUntil: 'domcontentloaded' })
    await page.locator('[data-home-page]').waitFor({ timeout: 10_000 })
    await page.locator('[data-home-new]').click({ timeout: 10_000 }).catch(() => {})
    await page.locator('[data-new-project-choice="canvas"]').click({ timeout: 10_000 })
    await page.waitForURL(/\/canvas\//, { timeout: 20_000 })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('[data-canvas-my-assets]').waitFor({ timeout: 10_000 }).catch(async (error) => {
      await page.screenshot({ path: path.join(out, `${file}-canvas-desktop-stub-failed.png`) })
      console.error({
        url: page.url(),
        body: (await page.locator('body').innerText().catch(() => '')).slice(0, 1200),
        errors: [...errors],
      })
      throw error
    })
    const kitsButtons = await page.locator('[data-canvas-my-assets]').count()
    const defaultsButtons = await page.locator('[data-canvas-defaults]').count()
    const stageWidthClosed = await page.locator('[data-canvas-stage]').evaluate((node) => node.getBoundingClientRect().width)
    await page.screenshot({ path: path.join(out, `${file}-canvas.png`) })
    report.push({ variant, surface: 'canvas', kitsButtons, defaultsButtons, stageWidthClosed, ...(await geometry(page)), errors: [...errors] })
    const myAssetsOpenStartedAt = Date.now()
    await page.locator('[data-canvas-my-assets]').click()
    await page.locator('[data-my-assets-slot][data-my-assets-open="true"]').waitFor({ timeout: 10_000 })
    const myAssetsOpenLatencyMs = Date.now() - myAssetsOpenStartedAt
    await page.waitForTimeout(260)
    await page.locator('[data-my-assets-drawer]').waitFor({ timeout: 10_000 })
    const drawer = await page.locator('[data-my-assets-drawer]').count()
    const sourceTabs = await page.locator('[data-my-assets-source]').count()
    const assetKinds = await page.locator('[data-my-assets-kind]').count()
    const drawerGeometry = await page.evaluate(() => {
      const root = document.querySelector('[data-my-assets-drawer]')
      const panel = root
      const slot = document.querySelector('[data-my-assets-shell-slot]')
      const stage = document.querySelector('[data-canvas-stage]')
      const rail = document.querySelector('[data-rail-slot]')
      const tabs = [...(root?.querySelectorAll('[data-my-assets-source]') ?? [])]
      const body = root?.querySelector('[data-my-assets-body]')
      const panelRect = panel?.getBoundingClientRect()
      const railRect = rail?.getBoundingClientRect()
      const stageRect = stage?.getBoundingClientRect()
      return {
        drawerLeft: panelRect?.left ?? -1,
        drawerWidth: panelRect?.width ?? 0,
        slotWidth: slot?.getBoundingClientRect().width ?? 0,
        slotTransitionDuration: slot ? getComputedStyle(slot).transitionDuration : '',
        drawerOpacity: root ? getComputedStyle(root).opacity : '',
        drawerTransitionDuration: root ? getComputedStyle(root).transitionDuration : '',
        stageWidthOpen: stage?.getBoundingClientRect().width ?? -1,
        drawerGapLeft: panelRect && railRect ? panelRect.left - railRect.right : -1,
        drawerGapRight: panelRect && stageRect ? stageRect.left - panelRect.right : -1,
        drawerGapTop: panelRect && railRect ? panelRect.top - railRect.top : -1,
        drawerGapBottom: panelRect && railRect ? railRect.bottom - panelRect.bottom : -1,
        drawerRadius: root ? getComputedStyle(root).borderRadius : '',
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
    await page.locator('[data-pinterest-panel]').waitFor({ timeout: 10_000 })
    const pinterestMounted = await page.locator('[data-pinterest-panel]').count()
    const pinterestLayout = await page.evaluate(() => {
      const panel = document.querySelector('[data-pinterest-panel]')
      const drawer = document.querySelector('[data-my-assets-drawer]')
      const panelRect = panel?.getBoundingClientRect()
      const drawerRect = drawer?.getBoundingClientRect()
      const text = panel?.textContent ?? ''
      return {
        chineseLabels:
          text.includes('应用编号') &&
          text.includes('应用密钥') &&
          text.includes('回调地址'),
        technicalEnglishLeaked:
          /Client ID|Client Secret|Redirect URI|Developer App/.test(text),
        overflowX: panel ? panel.scrollWidth > panel.clientWidth + 1 : true,
        insideDrawer:
          Boolean(panelRect && drawerRect) &&
          panelRect.left >= drawerRect.left - 1 &&
          panelRect.right <= drawerRect.right + 1,
      }
    })
    await page.screenshot({ path: path.join(out, `${file}-canvas-pinterest.png`) })
    await page.locator('[data-my-assets-source="clipper"]').click()
    await page.locator('[data-clipper-panel]').waitFor({ timeout: 10_000 })
    await page.waitForFunction(
      () => (window.__clipperAckIds?.length ?? 0) > 0,
      { timeout: 10_000 },
    )
    await page.locator('[data-clipper-item]').first().waitFor({ timeout: 10_000 })
    await page.locator('[data-clipper-extension-update]').waitFor({ timeout: 5_000 })
    const clipperMounted = await page.locator('[data-clipper-panel]').count()
    const clipperAckIds = await page.evaluate(() => window.__clipperAckIds ?? [])
    const clipperState = await page.evaluate(() => {
      const panel = document.querySelector('[data-clipper-panel]')
      const panelRect = panel?.getBoundingClientRect()
      return {
        installCards: panel?.querySelectorAll('[data-clipper-install-card]').length ?? 0,
        pairingCards: panel?.querySelectorAll('[data-clipper-pairing]').length ?? 0,
        filters: panel?.querySelectorAll('[data-clipper-filter]').length ?? 0,
        selectedFilters:
          panel?.querySelectorAll('[data-clipper-filter][aria-selected="true"]').length ?? 0,
        createCategoryActions:
          panel?.querySelectorAll('[data-clipper-create-category]').length ?? 0,
        selectionToggles:
          panel?.querySelectorAll('[data-clipper-selection-toggle]').length ?? 0,
        updateNotice:
          panel?.querySelectorAll('[data-clipper-extension-update]').length ?? 0,
        updateAction:
          panel?.querySelectorAll('[data-clipper-extension-update-action]').length ?? 0,
        items: panel?.querySelectorAll('[data-clipper-item]').length ?? 0,
        empty: panel?.querySelectorAll('[data-clipper-empty]').length ?? 0,
        emptyText: panel?.querySelector('[data-clipper-empty]')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
        overflowX: panel ? panel.scrollWidth > panel.clientWidth + 1 : true,
        insidePanel: Boolean(panelRect),
      }
    })
    await page.locator('[data-clipper-extension-update-action]').click()
    await page.waitForFunction(
      () => document.querySelector('[data-clipper-extension-update]')
        ?.textContent?.includes('扩展文件已更新'),
      { timeout: 5_000 },
    )
    const clipperUpdateMessage = await page
      .locator('[data-clipper-extension-update]')
      .innerText()
    const clipperUpdateOverflowX = await page.evaluate(() => {
      const notice = document.querySelector('[data-clipper-extension-update]')
      return notice ? notice.scrollWidth > notice.clientWidth + 1 : true
    })
    await page.screenshot({ path: path.join(out, `${file}-canvas-clipper-update.png`) })
    await page.locator('[data-clipper-filter="uncategorized"]').click()
    const clipperUncategorizedSelected = await page.locator(
      '[data-clipper-filter="uncategorized"][aria-selected="true"]',
    ).count()
    await page.locator('[data-clipper-filter="all"]').click()
    await page.locator('[data-clipper-selection-toggle]').click()
    await page.locator('[data-clipper-selection-bar]').waitFor({ timeout: 5_000 })
    const clipperEmptySelectionText =
      (await page.locator('[data-clipper-selection-bar]').innerText()).trim()
    await page.locator('[data-clipper-selection-bar] button').filter({ hasText: '取消' }).click()
    await page.locator('[data-clipper-selection-bar]').waitFor({ state: 'detached', timeout: 5_000 })
    await page.mouse.move(900, 80)
    await page.waitForTimeout(600)
    await page.screenshot({ path: path.join(out, `${file}-canvas-clipper.png`) })
    await page.evaluate(() => {
      delete window.isTauri
      delete window.__TAURI_INTERNALS__
    })
    if (clipperUpdateOnly) {
      report.push({
        variant,
        surface: 'clipperExtensionUpdate',
        clipperMounted,
        ...clipperState,
        clipperAckIds,
        clipperUpdateMessage,
        clipperUpdateOverflowX,
        errors: [...errors],
      })
      await context.close()
      continue
    }
    await page.locator('[data-my-assets-source="reference"]').click()
    await page.locator('[data-reference-empty]').waitFor({ timeout: 10_000 })
    const referenceEmptyActions = await page
      .locator('[data-reference-empty] button')
      .count()
    const referenceEmptyKitFolders = await page
      .locator('[data-my-assets-kit-folder]')
      .count()
    await page.screenshot({ path: path.join(out, `${file}-canvas-reference-empty.png`) })
    await page.locator('[data-reference-filter-trigger="source"]').click()
    await page.locator('[data-reference-filter-panel="source"]').waitFor({ timeout: 5_000 })
    await page.locator('[data-my-assets-body]').click({ position: { x: 8, y: 8 } })
    await page
      .locator('[data-reference-filter-panel="source"]')
      .waitFor({ state: 'detached', timeout: 5_000 })
    const referenceFilterClosedOnOutside = true
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
      {
        name: 'portrait-reference.png',
        mimeType: 'image/png',
        buffer: fixtures.portrait,
      },
    ])
    await page.waitForFunction(
      () => document.querySelectorAll('[data-my-assets-reference]').length >= 4,
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
    const previewHashes = [
      ...new Set(referenceRows.map((row) => row.assetHash).filter(Boolean)),
    ].slice(0, 4)
    if (previewHashes.length < 4) throw new Error('expected four reference fixture assets')
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
      assetHashes: previewHashes,
      resources: previewHashes.map((hash, index) => ({
        hash,
        role: index === 0 ? 'logo' : 'reference',
        name: ['Anbel 标志', '办公空间 1', '办公空间 2', '产品陈列'][index],
      })),
      colors: [{ id: 'brand-green', name: '主色', value: '#8fc466' }],
      fonts: [{ id: 'abeezee', name: 'ABeeZee', detail: 'Regular' }],
      createdAt: kitTime,
    }]
    const projectId = new URL(page.url()).pathname.split('/').filter(Boolean).at(-1)
    if (!projectId) throw new Error('canvas project id missing')
    const kitReferenceRows = [{
      id: `ref_kit_${kitId}`,
      projectId,
      title: 'Anbel',
      source: 'kit',
      kind: 'image',
      assetHash: previewHashes[0],
      assets: previewHashes.map((hash, index) => ({
        hash,
        role: index === 0 ? 'logo' : 'reference',
        name: ['Anbel 标志', '办公空间 1', '办公空间 2', '产品陈列'][index],
      })),
      kitId,
      kitVersion: 1,
      what: '自然有机风品牌套件。',
      createdAt: kitTime,
      updatedAt: kitTime,
    }]
    for (const [table, rows] of [
      ['contextKits', kitRows],
      ['contextKitVersions', kitVersionRows],
      ['referenceItems', kitReferenceRows],
    ]) {
      const seeded = await fetch(`${STORE}/bulkPut`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ table, rows }),
      })
      if (!seeded.ok) throw new Error(`${table} seed failed: HTTP ${seeded.status}`)
    }
    const myAssetsCloseStartedAt = Date.now()
    await page.locator('[data-my-assets-close]').click()
    await page.locator('[data-my-assets-slot][hidden]').waitFor({
      state: 'attached',
      timeout: 10_000,
    })
    const myAssetsCloseLatencyMs = Date.now() - myAssetsCloseStartedAt
    await page.locator('[data-canvas-my-assets]').click()
    await page.locator('[data-my-assets-slot][data-my-assets-open="true"]').waitFor({ timeout: 10_000 })
    await page.waitForTimeout(260)
    await page.locator('[data-my-assets-drawer]').waitFor({ timeout: 10_000 })
    await page.locator('[data-my-assets-source="assets"]').click()
    await page.locator('[data-my-assets-shelf]').waitFor({ timeout: 10_000 })
    await page.locator('[data-my-assets-source="reference"]').click()
    await page.locator('[data-my-assets-kit-folder]').waitFor({ timeout: 10_000 })
    await page.waitForFunction(
      () => document.querySelectorAll('[data-my-assets-reference]').length >= 4,
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
    const referenceExpandActions = await page.locator('[data-my-assets-reference-expand]').count()
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
        referenceGridOverflowPx: grid
          ? Math.max(0, grid.scrollWidth - grid.clientWidth)
          : -1,
        referenceGridOverflowX: grid
          ? grid.scrollWidth > grid.clientWidth + 2
          : true,
      }
    })
    await page.screenshot({ path: path.join(out, `${file}-canvas-reference.png`) })
    await page.locator('[data-my-assets-reference]').first().click({ button: 'right' })
    await page.locator('[data-reference-card-menu]').waitFor({ timeout: 5_000 })
    const referenceMenuActions = await page.locator('[data-reference-card-action]').count()
    await page.screenshot({ path: path.join(out, `${file}-canvas-reference-menu.png`) })
    await page.locator('[data-reference-card-action="open"]').click()
    await page.locator('[data-reference-lightbox]').waitFor({ timeout: 10_000 })
    const referenceMenuOpenActionWorks =
      (await page.locator('[data-reference-lightbox]').count()) === 1
    await page.keyboard.press('Escape')
    await page.locator('[data-reference-lightbox]').waitFor({ state: 'detached', timeout: 5_000 })
    await page.locator('[data-reference-filter-trigger="source"]').click()
    await page.locator('[data-reference-filter-panel="source"]').waitFor({ timeout: 5_000 })
    const referenceFilterIcon = await page.locator('[data-reference-filter-trigger="source"] svg').evaluate((svg) => ({
      circles: svg.querySelectorAll('circle').length,
      paths: svg.querySelectorAll('path').length,
    }))
    await page.locator('[data-reference-filter-kind="image"]').check()
    await page.locator('[data-reference-filter-source="file"]').check()
    await page.waitForFunction(
      () =>
        document.querySelectorAll('[data-my-assets-reference]').length === 4 &&
        document.querySelectorAll('[data-my-assets-kit-folder]').length === 0,
      { timeout: 5_000 },
    )
    const referenceFilteredCards = await page.locator('[data-my-assets-reference]').count()
    const referenceFilteredFolders = await page.locator('[data-my-assets-kit-folder]').count()
    await page.screenshot({ path: path.join(out, `${file}-canvas-reference-filter.png`) })
    await page.locator('[data-reference-filter-kind="image"]').uncheck()
    await page.locator('[data-reference-filter-source="file"]').uncheck()
    await page.locator('[data-reference-filter-trigger="source"]').click()
    await page.locator('[data-reference-filter-panel="source"]').waitFor({ state: 'detached', timeout: 5_000 })
    await page.locator('[data-my-assets-reference]').first().hover()
    await page.waitForTimeout(180)
    const referenceExpandVisible = await page.locator('[data-my-assets-reference-expand]').first().evaluate(
      (button) => getComputedStyle(button).opacity === '1',
    )
    await page.screenshot({ path: path.join(out, `${file}-canvas-reference-hover.png`) })
    await page.locator('[data-my-assets-reference-expand]').first().click()
    await page.locator('[data-reference-lightbox]').waitFor({ timeout: 15_000 })
    const referenceExpandOpenedLightbox =
      (await page.locator('[data-reference-lightbox]').count()) === 1
    await page.keyboard.press('Escape')
    await page.locator('[data-reference-lightbox]').waitFor({ state: 'detached', timeout: 10_000 })
    await page.locator('[data-my-assets-reference-open]').first().dblclick()
    await page.locator('[data-reference-lightbox]').waitFor({ timeout: 15_000 })
    const referenceDoubleClickOpenedLightbox =
      (await page.locator('[data-reference-lightbox]').count()) === 1
    await page.keyboard.press('Escape')
    await page.locator('[data-reference-lightbox]').waitFor({ state: 'detached', timeout: 10_000 })
    await page.locator('[data-my-assets-reference-open]').first().click()
    await page.locator('[data-agent-panel]').waitFor({ timeout: 15_000 })
    await page.locator('[data-agent-composer] [data-mention-kind="reference"]').first().waitFor({ timeout: 15_000 })
    const referenceClickChipCount =
      await page.locator('[data-agent-composer] [data-mention-kind="reference"]').count()
    await page.waitForFunction(
      () => {
        const chip = document.querySelector('[data-agent-composer] [data-mention-kind="reference"]')
        return chip?.getAttribute('data-has-thumb') === 'true' &&
          Boolean(chip.querySelector('img'))
      },
      { timeout: 15_000 },
    )
    const referenceChipThumbLoaded = await page
      .locator('[data-agent-composer] [data-mention-kind="reference"]')
      .first()
      .evaluate((chip) => {
        const image = chip.querySelector('img')
        return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0
      })
    const referenceChipNoIconFlash = await page
      .locator('[data-agent-composer] [data-mention-kind="reference"]')
      .first()
      .evaluate((chip) => {
        const icon = chip.querySelector('[class*="chipIcon"]')
        const thumb = chip.querySelector('[class*="chipThumb"]')
        return Boolean(icon && getComputedStyle(icon).display === 'none' && thumb)
      })
    const referenceChipShape = await page
      .locator('[data-agent-composer] [data-mention-kind="reference"]')
      .first()
      .evaluate((chip) => {
        const chipRect = chip.getBoundingClientRect()
        const imageRect = chip.querySelector('img')?.getBoundingClientRect()
        return {
          className: chip.className,
          width: Math.round(chipRect.width),
          height: Math.round(chipRect.height),
          thumbWidth: Math.round(imageRect?.width ?? 0),
          thumbHeight: Math.round(imageRect?.height ?? 0),
        }
      })
    const agentGeometry = await page.evaluate(() => {
      const slot = document.querySelector('[data-agent-shell-slot]')
      const surface = slot?.firstElementChild
      const workspace = document.querySelector('[data-app-workspace]')
      const rail = document.querySelector('[data-rail-slot]')
      const myAssets = document.querySelector('[data-my-assets-drawer]')
      const surfaceRect = surface?.getBoundingClientRect()
      const workspaceRect = workspace?.getBoundingClientRect()
      const railRect = rail?.getBoundingClientRect()
      const myAssetsRect = myAssets?.getBoundingClientRect()
      return {
        width: surfaceRect?.width ?? 0,
        myAssetsWidth: myAssetsRect?.width ?? 0,
        workspaceWidth: workspaceRect?.width ?? 0,
        gapLeft:
          workspaceRect && surfaceRect ? surfaceRect.left - workspaceRect.right : -1,
        gapRight:
          surfaceRect ? document.documentElement.clientWidth - surfaceRect.right : -1,
        gapTop: surfaceRect && railRect ? surfaceRect.top - railRect.top : -1,
        gapBottom: surfaceRect && railRect ? railRect.bottom - surfaceRect.bottom : -1,
        radius:
          (slot?.querySelector('[data-agent-panel]') &&
            getComputedStyle(slot.querySelector('[data-agent-panel]')).borderRadius) ||
          '',
      }
    })
    await page.waitForTimeout(350)
    await page.screenshot({ path: path.join(out, `${file}-canvas-reference-click-agent.png`) })
    await page.locator('[data-agent-close]').click()
    await page.locator('[data-agent-panel]').waitFor({ state: 'hidden', timeout: 10_000 })
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
    await page.locator('[data-my-assets-kit-folder-add]').click()
    await page.locator('[data-agent-panel]').waitFor({ timeout: 15_000 })
    await page.locator('[data-agent-composer] [data-mention-kind="reference"]').first().waitFor({ timeout: 15_000 })
    const referenceFolderChipCount =
      await page.locator('[data-agent-composer] [data-mention-kind="reference"]').count()
    await page.waitForTimeout(350)
    await page.screenshot({ path: path.join(out, `${file}-canvas-kit-folder-agent.png`) })
    await page.locator('[data-agent-close]').click()
    await page.locator('[data-agent-panel]').waitFor({ state: 'hidden', timeout: 10_000 })
    await page.locator('[data-my-assets-kit-folder]').first().hover()
    await page.locator('[data-my-assets-kit-folder-open]').click()
    await page.locator('[data-reference-kit-panel]').waitFor({ timeout: 10_000 })
    const referenceKitItems = await page.locator('[data-reference-kit-item]').count()
    const referenceKitImageItems = await page.locator('[data-reference-kit-item="image"]').count()
    await page.screenshot({ path: path.join(out, `${file}-canvas-reference-kit.png`) })
    await page.locator('[data-reference-kit-item-add]').first().click()
    await page.locator('[data-agent-panel]').waitFor({ timeout: 15_000 })
    await page.locator('[data-agent-composer] [data-mention-kind="reference"]').first().waitFor({ timeout: 15_000 })
    const referenceKitClickChipCount =
      await page.locator('[data-agent-composer] [data-mention-kind="reference"]').count()
    await page.locator('[data-agent-close]').click()
    await page.locator('[data-agent-panel]').waitFor({ state: 'hidden', timeout: 10_000 })
    await page.locator('[data-reference-kit-item="image"]').nth(1).hover()
    await page.waitForTimeout(180)
    const referenceKitExpandVisible = await page.locator('[data-reference-kit-item-expand]').nth(1).evaluate(
      (button) => getComputedStyle(button).opacity === '1',
    )
    await page.screenshot({ path: path.join(out, `${file}-canvas-reference-kit-hover.png`) })
    await page.locator('[data-reference-kit-item-expand]').nth(1).click()
    await page.locator('[data-reference-lightbox]').waitFor({ timeout: 15_000 })
    const referenceKitExpandOpenedLightbox =
      (await page.locator('[data-reference-lightbox]').count()) === 1
    await page.keyboard.press('Escape')
    await page.locator('[data-reference-lightbox]').waitFor({ state: 'detached', timeout: 10_000 })
    await page.locator('[data-reference-kit-item-add]').nth(2).dblclick()
    await page.locator('[data-reference-lightbox]').waitFor({ timeout: 15_000 })
    const referenceKitDoubleClickOpenedLightbox =
      (await page.locator('[data-reference-lightbox]').count()) === 1
    await page.keyboard.press('Escape')
    await page.locator('[data-reference-lightbox]').waitFor({ state: 'detached', timeout: 10_000 })
    await page.locator('[data-reference-filter-trigger="kit"]').click()
    await page.locator('[data-reference-filter-panel="kit"]').waitFor({ timeout: 5_000 })
    await page.locator('[data-reference-filter-source="asset"]').check()
    await page.locator('[data-reference-filter-kind="image"]').check()
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
    const selectionChrome = await page.evaluate(() => {
      const frame = document.querySelector('[data-node-id][data-node-selected]')
      if (!frame) return { selectedFrame: 0 }
      const frameStyle = getComputedStyle(frame)
      const selectionStyle = getComputedStyle(frame, '::after')
      const wrapper = frame.closest('.react-flow__node')
      const handles = [...frame.querySelectorAll('[data-node-resize-corner]')]
      return {
        selectedFrame: 1,
        frameOutlineStyle: frameStyle.outlineStyle,
        frameBorderRadius: frameStyle.borderRadius,
        selectionBorderWidth: selectionStyle.borderTopWidth,
        selectionBorderStyle: selectionStyle.borderTopStyle,
        selectionBorderColor: selectionStyle.borderTopColor,
        wrapperContentVisibility: wrapper ? getComputedStyle(wrapper).contentVisibility : '',
        resizeHandles: handles.length,
        hiddenResizeHandles: handles.filter(
          (handle) =>
            handle.getAttribute('aria-hidden') === 'true'
            && handle.getAttribute('tabindex') === '-1'
            && getComputedStyle(handle).outlineStyle === 'none',
        ).length,
      }
    })
    await page.screenshot({ path: path.join(out, `${file}-canvas-reference-dropped.png`) })
    const surfaceBoxForBlankClick = await page
      .locator('[data-canvas-surface]')
      .boundingBox()
    if (!surfaceBoxForBlankClick) throw new Error('canvas surface missing')
    await page.locator('[data-canvas-surface]').click({
      position: {
        x: Math.round(surfaceBoxForBlankClick.width * 0.68),
        y: 120,
      },
    })
    await page.locator('[data-panel-anchor]').waitFor({ state: 'detached', timeout: 5_000 })
    const viewportTransformBeforeMinimap = await page.evaluate(() => {
      const viewport = document.querySelector('.react-flow__viewport')
      return viewport ? getComputedStyle(viewport).transform : ''
    })
    const minimapBox = await page.locator('[data-canvas-minimap]').boundingBox()
    if (!minimapBox) throw new Error('minimap missing')
    await page.locator('[data-canvas-minimap]').click({
      position: {
        x: Math.round(minimapBox.width * 0.72),
        y: Math.round(minimapBox.height * 0.68),
      },
    })
    await page.waitForTimeout(220)
    const viewportTransformAfterMinimap = await page.evaluate(() => {
      const viewport = document.querySelector('.react-flow__viewport')
      return viewport ? getComputedStyle(viewport).transform : ''
    })
    const minimapClickPanned =
      Boolean(viewportTransformBeforeMinimap) &&
      viewportTransformBeforeMinimap !== viewportTransformAfterMinimap
    await page.screenshot({ path: path.join(out, `${file}-canvas-minimap-panned.png`) })
    await page.locator('[data-node-id]').last().click({ position: { x: 24, y: 24 } })
    await page.locator('[data-follow-action="agent"]').waitFor({ timeout: 5_000 })
    await page.locator('[data-follow-action="agent"]').click()
    await page.locator('[data-agent-panel]').waitFor({ timeout: 15_000 })
    const nodeChip = page
      .locator('[data-agent-composer] [data-mention-kind="node"]')
      .first()
    await nodeChip.waitFor({ timeout: 15_000 })
    await page.waitForFunction(
      () => {
        const chip = document.querySelector('[data-agent-composer] [data-mention-kind="node"]')
        const image = chip?.querySelector('img')
        return chip?.getAttribute('data-has-thumb') === 'true' &&
          image instanceof HTMLImageElement &&
          image.complete &&
          image.naturalWidth > 0
      },
      { timeout: 15_000 },
    )
    const nodeChipShape = await nodeChip.evaluate((chip) => {
      const chipRect = chip.getBoundingClientRect()
      const imageRect = chip.querySelector('img')?.getBoundingClientRect()
      return {
        className: chip.className,
        width: Math.round(chipRect.width),
        height: Math.round(chipRect.height),
        thumbWidth: Math.round(imageRect?.width ?? 0),
        thumbHeight: Math.round(imageRect?.height ?? 0),
      }
    })
    const referenceChipInSameComposer = page
      .locator('[data-agent-composer] [data-mention-kind="reference"]')
      .first()
    await referenceChipInSameComposer.waitFor({ timeout: 15_000 })
    const referenceChipShapeForCompare = await referenceChipInSameComposer.evaluate((chip) => {
      const chipRect = chip.getBoundingClientRect()
      const imageRect = chip.querySelector('img')?.getBoundingClientRect()
      return {
        className: chip.className,
        width: Math.round(chipRect.width),
        height: Math.round(chipRect.height),
        thumbWidth: Math.round(imageRect?.width ?? 0),
        thumbHeight: Math.round(imageRect?.height ?? 0),
      }
    })
    const nodeReferenceChipsMatch =
      nodeChipShape.className === referenceChipShapeForCompare.className &&
      nodeChipShape.width === referenceChipShapeForCompare.width &&
      nodeChipShape.height === referenceChipShapeForCompare.height &&
      nodeChipShape.thumbWidth === referenceChipShapeForCompare.thumbWidth &&
      nodeChipShape.thumbHeight === referenceChipShapeForCompare.thumbHeight
    await page.screenshot({ path: path.join(out, `${file}-canvas-node-reference-chips.png`) })
    await page.locator('[data-agent-close]').click()
    await page.locator('[data-agent-panel]').waitFor({ state: 'hidden', timeout: 10_000 })
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
    await page.locator('[data-agent-composer] [data-mention-kind="reference"]').first().waitFor({ timeout: 15_000 })
    const referenceChipMounted = await page.locator('[data-agent-composer] [data-mention-kind="reference"]').count()
    const referenceLightboxClosedByAgent =
      (await page.locator('[data-reference-lightbox]').count()) === 0
    await page.waitForTimeout(350)
    await page.screenshot({ path: path.join(out, `${file}-canvas-reference-agent.png`) })
    await page.locator('[data-agent-close]').click()
    await page.locator('[data-agent-panel]').waitFor({ state: 'hidden', timeout: 10_000 })
    await page.locator('[data-my-assets-source="assets"]').click()
    await page.locator('[data-my-assets-shelf]').waitFor({ timeout: 10_000 })
    await page.locator('[data-my-assets-kit-card]').waitFor({ timeout: 10_000 })
    await page.waitForFunction(
      () => {
        const images = [...document.querySelectorAll('[data-my-assets-kit-card] img')]
        return images.length === 4 &&
          images.every((image) => image.complete && image.naturalWidth > 0)
      },
      { timeout: 15_000 },
    )
    const shelfState = await page.evaluate(() => {
      const tabs = [...document.querySelectorAll('[data-my-assets-kind]')]
      const selected = tabs.find((tab) => tab.getAttribute('aria-selected') === 'true')
      const create = document.querySelector('[data-my-assets-create-kit]')
      const card = document.querySelector('[data-my-assets-kit-card]')
      const createRect = create?.getBoundingClientRect()
      const cardRect = card?.getBoundingClientRect()
      return {
        shelfTabs: tabs.length,
        selectedShelfTabs: tabs.filter((tab) => tab.getAttribute('aria-selected') === 'true').length,
        selectedShelfText: selected?.textContent?.trim() ?? '',
        selectedShelfColor: selected ? getComputedStyle(selected).color : '',
        selectedShelfUnderline: selected
          ? getComputedStyle(selected, '::after').backgroundColor
          : '',
        createKitCards: create ? 1 : 0,
        shelfKitCards: card ? 1 : 0,
        shelfKitThumbs: card?.querySelectorAll('img').length ?? 0,
        shelfCreateBeforeKit: Boolean(createRect && cardRect && createRect.top < cardRect.top),
      }
    })
    await page.screenshot({ path: path.join(out, `${file}-canvas-kits.png`) })
    await page.locator('[data-my-assets-kit-open]').click()
    await page.locator('[data-my-assets-kit-detail]').waitFor({ timeout: 10_000 })
    const shelfDetailSections = await page.locator('[data-my-assets-kit-detail] section').count()
    const shelfDetailTitle =
      (await page.locator('[data-my-assets-kit-detail] h2').textContent({ timeout: 5_000 }))?.trim() ?? ''
    const kitCardChrome = await page.evaluate(() => {
      const card = document.querySelector('[data-my-assets-kit-asset-card]')
      const thumb = card?.querySelector('[data-my-assets-kit-asset-thumb]')
      const meta = card?.querySelector('[data-my-assets-kit-asset-meta]')
      const add = card?.querySelector('[data-my-assets-kit-asset-add]')
      const menu = card?.querySelector('[data-my-assets-kit-menu="asset"]')
      const label = meta?.querySelector('small')
      const cardRect = card?.getBoundingClientRect()
      const thumbRect = thumb?.getBoundingClientRect()
      const metaRect = meta?.getBoundingClientRect()
      const addRect = add?.getBoundingClientRect()
      const menuRect = menu?.getBoundingClientRect()
      const labelRect = label?.getBoundingClientRect()
      return {
        addTop: addRect && thumbRect ? Math.round(addRect.top - thumbRect.top) : -1,
        addRight: addRect && thumbRect ? Math.round(thumbRect.right - addRect.right) : -1,
        menuBottom: menuRect && metaRect ? Math.round(metaRect.bottom - menuRect.bottom) : -1,
        menuRight: menuRect && metaRect ? Math.round(metaRect.right - menuRect.right) : -1,
        labelBeforeMenu: Boolean(labelRect && menuRect && labelRect.right <= menuRect.left),
        cardInset:
          cardRect && thumbRect
            ? Math.round(thumbRect.left - cardRect.left)
            : -1,
      }
    })
    await page.screenshot({ path: path.join(out, `${file}-canvas-kit-detail.png`) })
    const kitAssetCardsBefore = await page.locator('[data-my-assets-kit-asset-add]').count()
    await page.locator('[data-my-assets-kit-description-edit]').click()
    await page.locator('[data-my-assets-kit-description]').fill('用于验证品牌套件直接编辑与多层素材复用。')
    const kitDescriptionEditorGeometry = await page.evaluate(() => {
      const textarea = document.querySelector('[data-my-assets-kit-description]')
      const section = textarea?.closest('section')
      const beforeRect = textarea?.getBoundingClientRect()
      if (textarea instanceof HTMLTextAreaElement) textarea.style.height = '180px'
      const textareaRect = textarea?.getBoundingClientRect()
      const sectionRect = section?.getBoundingClientRect()
      return {
        boxSizing: textarea ? getComputedStyle(textarea).boxSizing : '',
        scrollbarGutter: textarea ? getComputedStyle(textarea).scrollbarGutter : '',
        widthDelta:
          beforeRect && textareaRect
            ? Math.round(Math.abs(textareaRect.width - beforeRect.width) * 10) / 10
            : -1,
        textareaLeft: textareaRect?.left ?? -1,
        textareaRight: textareaRect?.right ?? -1,
        sectionLeft: sectionRect?.left ?? -1,
        sectionRight: sectionRect?.right ?? -1,
        contained:
          Boolean(textareaRect && sectionRect) &&
          textareaRect.left >= sectionRect.left - 1 &&
          textareaRect.right <= sectionRect.right + 1,
      }
    })
    await page.screenshot({ path: path.join(out, `${file}-canvas-kit-description-editing.png`) })
    await page.locator('[data-my-assets-kit-description-save]').click()
    await page.waitForFunction(
      () => document.querySelector('[data-my-assets-kit-detail] [aria-live="polite"]')?.textContent?.includes('描述已更新'),
      { timeout: 10_000 },
    )
    const kitDescriptionSaved =
      (await page.getByText('用于验证品牌套件直接编辑与多层素材复用。').count()) === 1

    await page.locator('[data-my-assets-kit-menu="color"]').first().click()
    const kitColorMenuGeometry = await page.evaluate(() => {
      const button = document.querySelector('[data-my-assets-kit-menu="color"]')
      const meta = button?.parentElement
      const label = meta?.querySelector('small')
      const buttonRect = button?.getBoundingClientRect()
      const metaRect = meta?.getBoundingClientRect()
      const labelRect = label?.getBoundingClientRect()
      return {
        position: button ? getComputedStyle(button).position : '',
        menuBottom: buttonRect && metaRect ? Math.round(metaRect.bottom - buttonRect.bottom) : -1,
        menuRight: buttonRect && metaRect ? Math.round(metaRect.right - buttonRect.right) : -1,
        labelBeforeMenu: Boolean(labelRect && buttonRect && labelRect.right <= buttonRect.left),
      }
    })
    await page.screenshot({ path: path.join(out, `${file}-canvas-kit-color-menu.png`) })
    await page.locator('[data-reference-card-action="edit"]').click()
    await page.locator('[data-color-picker-popover]').waitFor({ timeout: 5_000 })
    const kitColorEditorOpened = (await page.locator('[data-color-picker-popover]').count()) === 1
    await page.screenshot({ path: path.join(out, `${file}-canvas-kit-color-editor.png`) })
    await page.locator('[data-color-hex-input]').fill('112233')
    await page.locator('[data-color-confirm]').click()
    await page.waitForFunction(
      () => document.querySelector('[data-my-assets-kit-detail] [aria-live="polite"]')?.textContent?.includes('颜色已更新'),
      { timeout: 10_000 },
    )

    await page.locator('[data-my-assets-kit-menu="font"]').first().click()
    const kitFontMenuGeometry = await page.evaluate(() => {
      const button = document.querySelector('[data-my-assets-kit-menu="font"]')
      const meta = button?.parentElement
      const label = meta?.querySelector('small')
      const buttonRect = button?.getBoundingClientRect()
      const metaRect = meta?.getBoundingClientRect()
      const labelRect = label?.getBoundingClientRect()
      return {
        position: button ? getComputedStyle(button).position : '',
        menuBottom: buttonRect && metaRect ? Math.round(metaRect.bottom - buttonRect.bottom) : -1,
        menuRight: buttonRect && metaRect ? Math.round(metaRect.right - buttonRect.right) : -1,
        labelBeforeMenu: Boolean(labelRect && buttonRect && labelRect.right <= buttonRect.left),
      }
    })
    await page.screenshot({ path: path.join(out, `${file}-canvas-kit-font-menu.png`) })
    const fontChooserPromise = page.waitForEvent('filechooser')
    await page.locator('[data-reference-card-action="reupload"]').click()
    const fontChooser = await fontChooserPromise
    await fontChooser.setFiles({
      name: 'Fixture.ttf',
      mimeType: 'font/ttf',
      buffer: Buffer.from('00010000001000000000000000000000', 'hex'),
    })
    await page.waitForFunction(
      () => document.querySelector('[data-my-assets-kit-detail] [aria-live="polite"]')?.textContent?.includes('字体已重新上传'),
      { timeout: 15_000 },
    )
    await page.locator('[data-my-assets-kit-menu="font"]').first().click()
    await page.locator('[data-reference-card-action="edit"]').click()
    await page.locator('[data-my-assets-font-picker]').waitFor({ timeout: 5_000 })
    const kitFontLibraryOptions = await page.locator('[data-my-assets-font-option]').count()
    await page.screenshot({ path: path.join(out, `${file}-canvas-kit-font-picker.png`) })
    await page.keyboard.press('Escape')
    await page.locator('[data-my-assets-font-picker]').waitFor({ state: 'detached', timeout: 5_000 })

    const imageChooserPromise = page.waitForEvent('filechooser')
    await page.locator('[data-my-assets-kit-upload="reference"]').click()
    const imageChooser = await imageChooserPromise
    await imageChooser.setFiles({
      name: 'direct-reference.png',
      mimeType: 'image/png',
      buffer: fixtures.add,
    })
    await page.waitForFunction(
      (before) => document.querySelectorAll('[data-my-assets-kit-asset-add]').length > before,
      kitAssetCardsBefore,
      { timeout: 15_000 },
    )
    const kitAssetCardsAfterUpload =
      await page.locator('[data-my-assets-kit-asset-add]').count()
    await page.locator('[data-my-assets-kit-asset-add]').first().click()
    await page.locator('[data-agent-panel]').waitFor({ timeout: 15_000 })
    await page.locator('[data-agent-composer] [data-mention-kind="reference"]').first().waitFor({ timeout: 15_000 })
    const kitAssetAgentChipCount =
      await page.locator('[data-agent-composer] [data-mention-kind="reference"]').count()
    const kitAssetChipThumbLoaded = await page
      .locator('[data-agent-composer] [data-mention-kind="reference"]')
      .first()
      .evaluate((chip) => {
        const image = chip.querySelector('img')
        return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0
      })
    await page.locator('[data-agent-close]').click()
    await page.locator('[data-agent-panel]').waitFor({ state: 'hidden', timeout: 10_000 })
    await page.locator('[data-my-assets-kit-menu="asset"]').last().click()
    const imageReplaceChooserPromise = page.waitForEvent('filechooser')
    await page.locator('[data-reference-card-action="reupload"]').click()
    const imageReplaceChooser = await imageReplaceChooserPromise
    await imageReplaceChooser.setFiles({
      name: 'replaced-reference.png',
      mimeType: 'image/png',
      buffer: fixtures.replace,
    })
    await page.waitForFunction(
      () => document.querySelector('[data-my-assets-kit-detail] [aria-live="polite"]')?.textContent?.includes('图片已重新上传'),
      { timeout: 15_000 },
    )
    const kitAssetReuploaded =
      (await page.locator('[data-my-assets-kit-asset-add]').count()) > kitAssetCardsBefore
    await page.screenshot({ path: path.join(out, `${file}-canvas-kit-detail-edited.png`) })
    await page.locator('[data-my-assets-kit-menu="asset"]').last().click()
    await page.locator('[data-reference-card-action="reupload"]').waitFor({ timeout: 5_000 })
    await page.screenshot({ path: path.join(out, `${file}-canvas-kit-asset-menu.png`) })
    await page.locator('[data-reference-card-action="delete"]').click()
    await page.waitForFunction(
      (before) => document.querySelectorAll('[data-my-assets-kit-asset-add]').length === before,
      kitAssetCardsBefore,
      { timeout: 15_000 },
    )
    const kitAssetCardsAfterDelete =
      await page.locator('[data-my-assets-kit-asset-add]').count()
    await page.locator('[data-my-assets-kit-back]').click()
    await page.locator('[data-my-assets-shelf]').waitFor({ timeout: 10_000 })
    await page.locator('[data-my-assets-kit-add]').click()
    await page.locator('[data-agent-panel]').waitFor({ timeout: 15_000 })
    await page.locator('[data-agent-composer] [data-mention-kind="reference"]').first().waitFor({ timeout: 15_000 })
    const shelfKitClickChipCount =
      await page.locator('[data-agent-composer] [data-mention-kind="reference"]').count()
    await page.waitForTimeout(350)
    await page.screenshot({ path: path.join(out, `${file}-canvas-kit-click-agent.png`) })
    await page.locator('[data-agent-close]').click()
    await page.locator('[data-agent-panel]').waitFor({ state: 'hidden', timeout: 10_000 })
    await page.locator('[data-my-assets-kit-open]').click()
    await page.locator('[data-my-assets-kit-detail]').waitFor({ timeout: 10_000 })
    await page.locator('[data-my-assets-kit-detail-add]').click()
    await page.locator('[data-agent-panel]').waitFor({ timeout: 15_000 })
    await page.locator('[data-agent-composer] [data-mention-kind="reference"]').first().waitFor({ timeout: 15_000 })
    const shelfDetailChipCount =
      await page.locator('[data-agent-composer] [data-mention-kind="reference"]').count()
    await page.locator('[data-agent-close]').click()
    await page.locator('[data-agent-panel]').waitFor({ state: 'hidden', timeout: 10_000 })
    await page.locator('[data-my-assets-source="reference"]').click()
    await page.locator('[data-my-assets-kit-folder]').waitFor({ timeout: 10_000 })
    const kitFoldersBeforeReferenceDelete = await page
      .locator('[data-my-assets-kit-folder]')
      .count()
    await page.locator('[data-my-assets-kit-folder]').first().click({
      button: 'right',
    })
    await page.locator('[data-reference-card-action="delete"]').waitFor({ timeout: 5_000 })
    await page.locator('[data-reference-card-action="delete"]').click()
    await page.waitForFunction(
      (before) =>
        document.querySelectorAll('[data-my-assets-kit-folder]').length < before,
      kitFoldersBeforeReferenceDelete,
      { timeout: 10_000 },
    )
    const kitFoldersAfterReferenceDelete = await page
      .locator('[data-my-assets-kit-folder]')
      .count()
    const kitRemovedFromReference =
      kitFoldersAfterReferenceDelete < kitFoldersBeforeReferenceDelete
    await page.screenshot({ path: path.join(out, `${file}-canvas-reference-kit-removed.png`) })
    const historyCanvasNodeIdsBefore = await page
      .locator('[data-node-id]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-node-id')))
    await page.locator('[data-my-assets-close]').click()
    const historyRows = Array.from({ length: 600 }, (_, index) => ({
      id: `history-load-${phase}-${variant.width}-${variant.theme}-${index}`,
      projectId,
      createdAt: kitTime + index,
      outputHashes: [previewHashes[index % previewHashes.length]],
      outputWidth: 320,
      outputHeight: 320,
      params: {
        prompt: `history fixture ${index}`,
        model: 'GPT Image 2',
      },
      sentModel: 'GPT Image 2',
    }))
    const historySeed = await fetch(`${STORE}/bulkPut`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ table: 'runRecords', rows: historyRows }),
    })
    if (!historySeed.ok) throw new Error(`history seed failed: HTTP ${historySeed.status}`)
    const historyLoadStartedAt = Date.now()
    await page.locator('[data-sidebar-item="/assets"]').click()
    await page.waitForURL('**/assets', { timeout: 15_000 })
    const historyCard = page.locator(`[data-asset-card="${previewHashes[0]}"]`).first()
    await historyCard.waitFor({ timeout: 20_000 })
    const historyLoadMs = Date.now() - historyLoadStartedAt
    const historyPaginationBeforeMore = await page
      .locator('[data-assets-count]')
      .evaluate((node) => ({
        runsLoaded: Number(node.getAttribute('data-assets-history-runs-loaded') ?? 0),
        totalRuns: Number(node.getAttribute('data-assets-history-total-runs') ?? 0),
        hasMore: node.getAttribute('data-assets-history-has-more') === 'true',
      }))
    await page.screenshot({ path: path.join(out, `${file}-history-first-page.png`) })
    const historyLoadMoreStartedAt = Date.now()
    const historyLoadMoreButton = page.locator('[data-assets-load-more]')
    if (historyPaginationBeforeMore.hasMore) {
      await historyLoadMoreButton.click()
      await page.waitForFunction(
        (before) =>
          Number(
            document
              .querySelector('[data-assets-count]')
              ?.getAttribute('data-assets-history-runs-loaded') ?? 0,
          ) > before,
        historyPaginationBeforeMore.runsLoaded,
        { timeout: 20_000 },
      )
    }
    const historyLoadMoreMs = historyPaginationBeforeMore.hasMore
      ? Date.now() - historyLoadMoreStartedAt
      : null
    const historyPaginationAfterMore = await page
      .locator('[data-assets-count]')
      .evaluate((node) => ({
        runsLoaded: Number(node.getAttribute('data-assets-history-runs-loaded') ?? 0),
        totalRuns: Number(node.getAttribute('data-assets-history-total-runs') ?? 0),
        hasMore: node.getAttribute('data-assets-history-has-more') === 'true',
      }))
    await historyCard.hover()
    const historySend = page.locator(`[data-asset-send="${previewHashes[0]}"]`).first()
    await historySend.waitFor({ state: 'visible', timeout: 10_000 })
    const historySendStartedAt = Date.now()
    await historySend.click()
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('[role="status"]')].some((node) =>
          node.textContent?.includes('已发送到画布'),
        ),
      { timeout: 20_000 },
    )
    const historySendMs = Date.now() - historySendStartedAt
    await page.locator('[data-sidebar-item="/canvas"]').click()
    await page.waitForURL(`**/canvas/${projectId}`, { timeout: 15_000 })
    await page.waitForFunction(
      (before) =>
        [...document.querySelectorAll('[data-node-id]')].some(
          (node) => !before.includes(node.getAttribute('data-node-id')),
        ),
      historyCanvasNodeIdsBefore,
      { timeout: 15_000 },
    )
    const historyImportPlacement = await page.evaluate((before) => {
      const surface = document.querySelector('[data-canvas-surface]')
      const surfaceRect = surface?.getBoundingClientRect()
      const added = [...document.querySelectorAll('[data-node-id]')].find(
        (node) => !before.includes(node.getAttribute('data-node-id')),
      )
      const nodeRect = added?.getBoundingClientRect()
      return {
        added: Boolean(added),
        imageLoaded:
          added?.querySelector('img') instanceof HTMLImageElement &&
          added.querySelector('img').complete &&
          added.querySelector('img').naturalWidth > 0,
        centerDeltaX:
          surfaceRect && nodeRect
            ? Math.round(
                Math.abs(
                  nodeRect.left +
                    nodeRect.width / 2 -
                    (surfaceRect.left + surfaceRect.width / 2),
                ),
              )
            : -1,
        centerDeltaY:
          surfaceRect && nodeRect
            ? Math.round(
                Math.abs(
                  nodeRect.top +
                    nodeRect.height / 2 -
                    (surfaceRect.top + surfaceRect.height / 2),
                ),
              )
            : -1,
        withinViewport:
          Boolean(surfaceRect && nodeRect) &&
          nodeRect.left >= surfaceRect.left - 1 &&
          nodeRect.right <= surfaceRect.right + 1 &&
          nodeRect.top >= surfaceRect.top - 1 &&
          nodeRect.bottom <= surfaceRect.bottom + 1,
      }
    }, historyCanvasNodeIdsBefore)
    await page.screenshot({ path: path.join(out, `${file}-history-import-centered.png`) })
    report.push({
      variant,
      surface: 'canvasKits',
      drawer,
      sourceTabs,
      assetKinds,
      pinterestMounted,
      pinterestLayout,
      clipperMounted,
      clipperAckIds,
      ...clipperState,
      clipperUpdateMessage,
      clipperUpdateOverflowX,
      clipperUncategorizedSelected,
      clipperEmptySelectionText,
      myAssetsOpenLatencyMs,
      myAssetsCloseLatencyMs,
      referenceCards,
      referenceFolders,
      referenceUpload,
      referenceEmptyActions,
      referenceEmptyKitFolders,
      referenceFilterClosedOnOutside,
      referenceExpandActions,
      referenceMenuActions,
      referenceMenuOpenActionWorks,
      referenceChipThumbLoaded,
      referenceChipNoIconFlash,
      referenceChipShape,
      referenceFilteredCards,
      referenceFilteredFolders,
      referenceFilterIcon,
      referenceFolderOpenVisible,
      referenceFolderImageLoaded,
      referenceFolderChipCount,
      referenceKitItems,
      referenceKitImageItems,
      referenceKitFilteredItems,
      referenceChipMounted,
      referenceExpandVisible,
      referenceExpandOpenedLightbox,
      referenceDoubleClickOpenedLightbox,
      referenceClickChipCount,
      agentGeometry,
      referenceKitClickChipCount,
      referenceKitExpandVisible,
      referenceKitExpandOpenedLightbox,
      referenceKitDoubleClickOpenedLightbox,
      shelfDetailSections,
      shelfDetailTitle,
      kitCardChrome,
      kitColorMenuGeometry,
      kitFontMenuGeometry,
      kitDescriptionEditorGeometry,
      kitDescriptionSaved,
      kitColorEditorOpened,
      kitFontLibraryOptions,
      kitAssetCardsBefore,
      kitAssetCardsAfterUpload,
      kitAssetCardsAfterDelete,
      kitAssetReuploaded,
      kitAssetAgentChipCount,
      kitAssetChipThumbLoaded,
      shelfKitClickChipCount,
      shelfDetailChipCount,
      kitFoldersBeforeReferenceDelete,
      kitFoldersAfterReferenceDelete,
      kitRemovedFromReference,
      historyLoadMs,
      historyLoadMoreMs,
      historyPaginationBeforeMore,
      historyPaginationAfterMore,
      historySendMs,
      historyImportPlacement,
      ...shelfState,
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
      nodeChipShape,
      referenceChipShapeForCompare,
      nodeReferenceChipsMatch,
      minimapClickPanned,
      selectionChrome,
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
