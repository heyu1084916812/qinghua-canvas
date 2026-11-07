#!/usr/bin/env node
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'
import { chromium } from 'playwright'

const ROOT = path.resolve(import.meta.dirname, '..')
const cdpPort = Number(process.env.QH_STORAGE_UI_CDP_PORT ?? 9446)
const storePort = Number(process.env.QH_STORAGE_UI_STORE_PORT ?? 18773)
const runtimeRoot = process.env.QH_STORAGE_UI_RUNTIME_ROOT ?? ''
const storeBase = `http://127.0.0.1:${storePort}`
const output = runtimeRoot || path.join(ROOT, '.playwright-verify', 'storage-log-release-ui')
fs.mkdirSync(output, { recursive: true })

const PROJECT_COUNT = 334
const ASSET_COUNT = 1400
const RUN_COUNT = 500
const now = Date.now()
const projects = Array.from({ length: PROJECT_COUNT }, (_, index) => ({
  id: `project-${index}`,
  name: `Project ${index}`,
  workbench: 'canvas',
  createdAt: now - PROJECT_COUNT + index,
  updatedAt: now - PROJECT_COUNT + index,
}))
projects.push({
  id: 'project-logs',
  name: 'release-storage-probe',
  workbench: 'canvas',
  createdAt: now,
  updatedAt: now,
})
const assetHash = (index) => (index + 1).toString(16).padStart(16, '0')
const assets = Array.from({ length: ASSET_COUNT }, (_, index) => ({
  id: assetHash(index),
  hash: assetHash(index),
  mime: index % 9 === 0 ? 'video/mp4' : 'image/png',
  width: 1024,
  height: 1024,
  bytesLength: 2024,
  createdAt: now - ASSET_COUNT + index,
}))
const runRecords = Array.from({ length: RUN_COUNT }, (_, index) => ({
  id: `run-${index}`,
  projectId: index % 2 === 0 ? 'project-logs' : `project-${index % PROJECT_COUNT}`,
  nodeId: `node-${index}`,
  taskId: `task-${index}`,
  status: 'succeeded',
  createdAt: now - RUN_COUNT + index,
  durationMs: 1,
  inputs: [],
  outputHashes: [assetHash(index % ASSET_COUNT)],
  params: { model: 'fixture-image', prompt: `fixture ${index}` },
  fingerprint: `fingerprint-${index}`,
  version: 1,
}))

async function waitForHttp(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // app is starting
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`timed out waiting for ${url}`)
}

async function bulkPut(table, rows) {
  const response = await fetch(`${storeBase}/bulkPut`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ table, rows }),
  })
  if (!response.ok) {
    throw new Error(`${table} seed failed: HTTP ${response.status} ${await response.text()}`)
  }
}

function fileSha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function readSourceState() {
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim()
  const status = spawnSync('git', ['status', '--porcelain=v1'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim()
  const rows = status ? status.split(/\r?\n/) : []
  return {
    head,
    clean: rows.length === 0,
    trackedClean: rows.every((row) => row.startsWith('??')),
    status: rows,
  }
}

async function measure(page, click, quickWait, fullWait) {
  const started = Date.now()
  await click()
  await page.waitForFunction(quickWait, null, { timeout: 45_000 })
  const quickMs = Date.now() - started
  await page.waitForFunction(fullWait, null, { timeout: 90_000 })
  return { quickMs, fullMs: Date.now() - started }
}

await waitForHttp(`http://127.0.0.1:${storePort}/health`)
await bulkPut('projects', projects)
await bulkPut('assets', assets)
await bulkPut('runRecords', runRecords)
await waitForHttp(`http://127.0.0.1:${cdpPort}/json/version`)

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`)
const errors = []
try {
  const context = browser.contexts()[0]
  const page = context.pages()[0] ?? (await context.waitForEvent('page'))
  await page.waitForURL(/tauri\.localhost/, { timeout: 30_000 })
  page.on('pageerror', (error) => errors.push(`page:${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console:${message.text()}`)
  })
  await page.evaluate(() => {
    localStorage.setItem('flow:onboarded', '1')
    localStorage.setItem('flow:canvasGuideDismissed', '1')
    localStorage.setItem('flow:theme', 'dark')
  })
  await page.goto('http://tauri.localhost/', { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.locator('[data-sidebar-settings]').waitFor({ state: 'visible', timeout: 30_000 })
  await page.locator('[data-sidebar-settings]').click()
  await page.locator('[data-global-settings-tab="storage"]').waitFor({ timeout: 20_000 })

  const quickWait = () => {
    const notPending = (selector) => {
      const text = document.querySelector(selector)?.textContent?.trim() ?? ''
      return text !== '' && text !== '…' && text !== '统计中…' && text !== '读取中…' && text !== '未知'
    }
    return notPending('[data-storage-count="used"]') && notPending('[data-storage-count="projects"]')
  }
  const fullWait = () => {
    const notPending = (selector) => {
      const text = document.querySelector(selector)?.textContent?.trim() ?? ''
      return text !== '' && text !== '…' && text !== '统计中…' && text !== '读取中…' && text !== '未知'
    }
    return (
      notPending('[data-storage-count="used"]') &&
      notPending('[data-storage-count="projects"]') &&
      notPending('[data-storage-count="assets"]') &&
      notPending('[data-storage-count="saved"]') &&
      ['images', 'videos', 'audio', 'other'].every((kind) =>
        notPending(`[data-storage-media="${kind}"]`),
      ) &&
      notPending('[data-storage-data-dir]') &&
      notPending('[data-storage-cache]')
    )
  }
  const storage = await measure(
    page,
    () => page.locator('[data-global-settings-tab="storage"]').click(),
    quickWait,
    fullWait,
  )
  const storageText = await page.locator('[data-storage-panel]').innerText()
  await page.screenshot({ path: path.join(output, 'storage-1440-dark.png'), fullPage: false })

  await page.locator('[data-global-settings-tab="theme"]').click()
  const reopenStarted = Date.now()
  await page.locator('[data-global-settings-tab="storage"]').click()
  await page.waitForFunction(fullWait, null, { timeout: 5_000 })
  const storageReopenMs = Date.now() - reopenStarted

  await page.locator('[data-global-settings-tab="allLogs"]').click()
  const globalStarted = Date.now()
  await page.locator('[data-run-log-row]').first().waitFor({ timeout: 45_000 })
  const globalLogsMs = Date.now() - globalStarted
  await page.screenshot({ path: path.join(output, 'global-log-1440-dark.png'), fullPage: false })

  await page.locator('[data-global-settings-close]').click()
  await page.goto('http://tauri.localhost/canvas/project-logs', {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  })
  await page.locator('[data-canvas-hydrated="true"]').waitFor({ timeout: 60_000 })
  await page.locator('[data-canvas-log]').waitFor({ timeout: 20_000 })
  const canvasStarted = Date.now()
  await page.locator('[data-canvas-log]').click()
  await page.waitForFunction(
    () =>
      document.querySelectorAll('[data-log-panel] [data-log-prompt]').length > 0 ||
      document.querySelector('[data-log-panel]')?.textContent?.includes('还没有运行记录') === true,
    null,
    { timeout: 45_000 },
  )
  const canvasLogsMs = Date.now() - canvasStarted
  await page.screenshot({ path: path.join(output, 'canvas-log-1440-dark.png'), fullPage: false })

  await page.setViewportSize({ width: 1024, height: 700 })
  await page.evaluate(() => localStorage.setItem('flow:theme', 'light'))
  await page.goto('http://tauri.localhost/', { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.locator('[data-sidebar-settings]').click()
  await page.locator('[data-global-settings-tab="storage"]').click()
  await page.waitForFunction(fullWait, null, { timeout: 90_000 })
  await page.screenshot({ path: path.join(output, 'storage-1024-light.png'), fullPage: false })

  const geometry = await page.evaluate(() => {
    const panel = document.querySelector('[data-global-settings-panel]')
    return {
      horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      panelOverflow: panel ? panel.scrollWidth - panel.clientWidth : null,
    }
  })
  const source = readSourceState()
  const releaseExe = path.join(ROOT, 'src-tauri', 'target', 'release', 'qinghua.exe')
  const report = {
    ok:
      errors.length === 0 &&
      storage.quickMs <= 1_500 &&
      storage.fullMs <= 5_000 &&
      storageReopenMs <= 500 &&
      globalLogsMs <= 1_500 &&
      canvasLogsMs <= 1_500 &&
      !storageText.includes('统计中…') &&
      !storageText.includes('读取中…') &&
      geometry.horizontalOverflow === 0 &&
      (geometry.panelOverflow ?? 0) === 0,
    source,
    release: {
      path: path.relative(ROOT, releaseExe),
      sha256: fileSha256(releaseExe),
    },
    timings: {
      storageQuickMs: storage.quickMs,
      storageFullMs: storage.fullMs,
      storageReopenMs,
      globalLogsMs,
      canvasLogsMs,
    },
    seed: { projects: projects.length, assets: assets.length, runRecords: runRecords.length },
    geometry,
    errors,
    screenshots: fs.readdirSync(output).filter((name) => name.endsWith('.png')),
  }
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  if (!report.ok) process.exitCode = 1
} finally {
  await browser.close().catch(() => undefined)
}
