#!/usr/bin/env node
/**
 * Current-HEAD first-paint probe for storage / global logs / canvas logs.
 *
 * Uses an isolated V1 shared store and the user's existing 1420 Vite origin.
 * The probe is read-only from the product's point of view after seeding; all
 * writes go into its own temporary data directory.
 */
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'

const root = process.cwd()
const outDir = path.join(root, '.playwright-verify', 'storage-log-first-paint-current')
const dataDir = path.join(outDir, 'shared-store-v1')
const storeExe = path.join(root, 'shared-store', 'target', 'debug', 'qinghua-store.exe')
const base = process.env.QH_PROBE_BASE ?? 'http://127.0.0.1:1420'
const storePort = Number(process.env.QH_PROBE_STORE_PORT ?? 18791)
const storeBase = `http://127.0.0.1:${storePort}`

if (!Number.isInteger(storePort) || storePort < 1 || storePort > 65535) {
  throw new Error(`invalid isolated store port: ${storePort}`)
}
rmSync(outDir, { recursive: true, force: true })
mkdirSync(dataDir, { recursive: true })

const PROJECT_COUNT = 334
const ASSET_COUNT = 1400
const RUN_COUNT = 500
const now = Date.now()
const projects = Array.from({ length: PROJECT_COUNT }, (_, i) => ({
  id: `project-${i}`,
  name: `Project ${i}`,
  workbench: 'canvas',
  createdAt: now - PROJECT_COUNT + i,
  updatedAt: now - PROJECT_COUNT + i,
}))
projects.push({
  id: 'project-logs',
  name: '日志性能验证',
  workbench: 'canvas',
  createdAt: now,
  updatedAt: now,
})
const assets = Array.from({ length: ASSET_COUNT }, (_, i) => ({
  id: `asset-${i}`,
  hash: `asset-${i}`,
  mime: i % 9 === 0 ? 'video/mp4' : 'image/png',
  width: 1024,
  height: 1024,
  bytesLength: 2024,
  createdAt: now - ASSET_COUNT + i,
}))
const runRecords = Array.from({ length: RUN_COUNT }, (_, i) => ({
  id: `run-${i}`,
  projectId: i % 2 === 0 ? 'project-logs' : `project-${i % PROJECT_COUNT}`,
  nodeId: `node-${i}`,
  taskId: `task-${i}`,
  status: 'succeeded',
  createdAt: now - RUN_COUNT + i,
  durationMs: 1,
  inputs: [],
  outputHashes: [`asset-${i % ASSET_COUNT}`],
  params: { model: 'fixture-image', prompt: `fixture ${i}` },
  fingerprint: `fingerprint-${i}`,
  version: 1,
}))

async function waitHealth(child) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`isolated store exited: ${child.exitCode}`)
    try {
      const response = await fetch(`${storeBase}/health`)
      if (response.ok) {
        const body = await response.json()
        if (body?.service === 'qinghua-shared-store' && path.resolve(body.dataDir) === path.resolve(dataDir)) {
          return body
        }
      }
    } catch {
      // starting
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error('isolated store health timeout')
}

async function bulkPut(table, rows) {
  const response = await fetch(`${storeBase}/bulkPut`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ table, rows }),
  })
  if (!response.ok) throw new Error(`${table} seed failed: HTTP ${response.status}`)
}

function killTree(child) {
  if (!child?.pid || child.exitCode !== null) return
  spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
}

const store = spawn(storeExe, [
  '--data-dir', dataDir,
  '--backend', 'v1',
  '--port', String(storePort),
], {
  cwd: root,
  env: {
    ...process.env,
    LOCALAPPDATA: path.join(outDir, 'localappdata'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
})
const storeLog = path.join(outDir, 'store.log')
const storeStream = (await import('node:fs')).createWriteStream(storeLog)
store.stdout.pipe(storeStream)
store.stderr.pipe(storeStream)

let browser
const results = []
const errors = []
try {
  const health = await waitHealth(store)
  await bulkPut('projects', projects)
  await bulkPut('assets', assets)
  await bulkPut('runRecords', runRecords)
  browser = await chromium.launch({
    executablePath: process.env.QH_PROBE_CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    args: ['--no-proxy-server'],
  })

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await context.addInitScript((port) => {
    window.__QINGHUA_SHARED_STORE_PORT__ = port
    localStorage.setItem('flow:onboarded', '1')
    localStorage.setItem('flow:canvasGuideDismissed', '1')
    localStorage.setItem('flow:theme', 'dark')
  }, storePort)
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push(`page:${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console:${message.text()}`)
  })
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await page.locator('[data-sidebar-settings]').waitFor({ state: 'visible', timeout: 20_000 })
  await page.locator('[data-sidebar-settings]').click()
  await page.locator('[data-global-settings-tab="channels"]').waitFor({ state: 'visible', timeout: 20_000 })

  const measure = async (label, click, waitFor) => {
    const start = Date.now()
    await click()
    await page.waitForFunction(waitFor, null, { timeout: 30_000 })
    const elapsedMs = Date.now() - start
    const result = { label, elapsedMs }
    results.push(result)
    console.log(label, `${elapsedMs}ms`)
    await page.screenshot({ path: path.join(outDir, `${label}.png`), fullPage: false })
    return result
  }

  await measure(
    'storage-usage-and-projects',
    () => page.locator('[data-global-settings-tab="storage"]').click(),
    () => {
      const used = document.querySelector('[data-storage-count="used"]')?.textContent?.trim() ?? ''
      const projects = document.querySelector('[data-storage-count="projects"]')?.textContent?.trim() ?? ''
      return used !== '' && used !== '…' && projects !== '' && projects !== '…'
    },
  )
  await measure(
    'global-log-first-row',
    () => page.locator('[data-global-settings-tab="allLogs"]').click(),
    () => document.querySelectorAll('[data-run-log-row]').length > 0,
  )
  await page.locator('[data-global-settings-close]').click()
  await page.goto(`${base}/canvas/project-logs`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await page.locator('[data-canvas-log]').waitFor({ state: 'visible', timeout: 20_000 })
  await measure(
    'canvas-log-first-row',
    () => page.locator('[data-canvas-log]').click(),
    () => document.querySelectorAll('[data-log-panel] [data-log-prompt]').length > 0 ||
      document.querySelector('[data-log-panel]')?.textContent?.includes('还没有运行记录') === true,
  )
  const geometry = await page.evaluate(() => ({
    horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    panelOverflow: (() => {
      const panel = document.querySelector('[data-global-settings-panel]')
      return panel ? panel.scrollWidth - panel.clientWidth : 0
    })(),
  }))
  await context.close()

  const summary = {
    generatedAt: new Date().toISOString(),
    gitHead: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim(),
    base,
    storeBase,
    health: { backend: health.backend, version: health.version },
    seed: { projects: projects.length, assets: assets.length, runRecords: runRecords.length },
    results,
    geometry,
    errors,
  }
  writeFileSync(path.join(outDir, 'result.json'), JSON.stringify(summary, null, 2))
  console.log(JSON.stringify(summary, null, 2))
  if (errors.length > 0) process.exitCode = 1
} finally {
  await browser?.close().catch(() => undefined)
  killTree(store)
  await new Promise((resolve) => storeStream.end(resolve))
}
