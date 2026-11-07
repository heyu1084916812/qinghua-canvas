#!/usr/bin/env node
/**
 * Production-build first-paint probe for storage / global logs / canvas logs.
 *
 * Serves the current dist/ with `vite preview`, seeds an isolated V1 shared
 * store with the same fixture volume as the dev probe, and aggregates requests
 * by method + path + table so hydrate storms are visible in production.
 */
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, createWriteStream } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'

const root = process.cwd()
const outputRoot = path.join(root, '.playwright-verify', 'storage-log-first-paint-production')
const runStamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 23)
const outDir = path.join(outputRoot, runStamp)
const dataDir = path.join(outDir, 'shared-store-v1')
const storeExe = path.join(root, 'shared-store', 'target', 'debug', 'qinghua-store.exe')
const distDir = path.join(root, 'dist')
const previewPort = Number(process.env.QH_PROBE_PREVIEW_PORT ?? 4180)
const base = process.env.QH_PROBE_BASE ?? `http://127.0.0.1:${previewPort}`
const storePort = Number(process.env.QH_PROBE_STORE_PORT ?? 41791)
const storeBase = `http://127.0.0.1:${storePort}`

for (const [label, value] of [['preview port', previewPort], ['store port', storePort]]) {
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`invalid ${label}: ${value}`)
  }
}
for (const reserved of [1420, 18765, 18766, 18791]) {
  if ([previewPort, storePort].includes(reserved)) {
    throw new Error(`port ${reserved} is reserved for the user's services`)
  }
}
if (!existsSync(path.join(distDir, 'index.html'))) {
  throw new Error('dist/index.html not found; run npm run build first')
}
if (!existsSync(storeExe)) {
  throw new Error('shared-store debug binary not found; build shared-store first')
}

mkdirSync(dataDir, { recursive: true })

function hashDist(dir) {
  const hash = createHash('sha256')
  let files = 0
  const walk = (current, relative = '') => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const nextRelative = relative ? `${relative}/${entry.name}` : entry.name
      const next = path.join(current, entry.name)
      if (entry.isDirectory()) {
        walk(next, nextRelative)
      } else if (entry.isFile()) {
        files += 1
        hash.update(nextRelative)
        hash.update('\0')
        hash.update(readFileSync(next))
        hash.update('\0')
      }
    }
  }
  walk(dir)
  return { sha256: hash.digest('hex'), files }
}

const distFingerprint = hashDist(distDir)
const gitHead = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim()
const gitStatus = spawnSync('git', ['status', '--porcelain=v1'], { cwd: root, encoding: 'utf8' }).stdout.trim()

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
  name: 'production-probe',
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
    if (child.exitCode !== null) throw new Error(`child process exited: ${child.exitCode}`)
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

async function waitHttp(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (preview.exitCode !== null) throw new Error(`vite preview exited: ${preview.exitCode}`)
    try {
      const response = await fetch(url, { redirect: 'manual' })
      if (response.ok) return response
    } catch {
      // starting
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error('vite preview health timeout')
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
  env: { ...process.env, LOCALAPPDATA: path.join(outDir, 'localappdata') },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
})
const storeLog = path.join(outDir, 'store.log')
const storeStream = createWriteStream(storeLog)
store.stdout.pipe(storeStream)
store.stderr.pipe(storeStream)

const preview = spawn(process.execPath, [
  path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'),
  'preview',
  '--port', String(previewPort),
  '--strictPort',
  '--host', '127.0.0.1',
], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
})
const previewLog = path.join(outDir, 'preview.log')
const previewStream = createWriteStream(previewLog)
preview.stdout.pipe(previewStream)
preview.stderr.pipe(previewStream)

let browser
const results = []
const errors = []
const requests = []
const requestTimings = new WeakMap()

function requestTable(request) {
  const url = new URL(request.url())
  const method = request.method()
  if (method === 'GET' && url.pathname === '/rows') {
    return url.searchParams.get('table') ?? null
  }
  if (method !== 'POST') return null
  const raw = request.postData()
  if (!raw) return null
  try {
    const body = JSON.parse(raw)
    return typeof body?.table === 'string' ? body.table : null
  } catch {
    return null
  }
}

try {
  const health = await waitHealth(store)
  await waitHttp(base)
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
  // The store allowlist only knows 1420 / tauri.localhost. Rather than changing
  // product code, the probe relaxes CORS for its own isolated store traffic.
  await context.route(`${storeBase}/**`, async (route) => {
    const request = route.request()
    if (request.method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': base,
          'access-control-allow-methods': 'GET,POST,OPTIONS',
          'access-control-allow-headers': 'content-type',
        },
      })
      return
    }
    let response
    try {
      response = await route.fetch()
    } catch (error) {
      if (/context disposed|closed/i.test(String(error))) return
      throw error
    }
    const headers = { ...response.headers(), 'access-control-allow-origin': base }
    try {
      await route.fulfill({ response, headers })
    } catch {
      // navigation can dispose the response while the route is still pending
    }
  })
  page.on('request', (request) => {
    if (!request.url().startsWith(storeBase)) return
    const entry = {
      label: 'app-boot',
      method: request.method(),
      path: new URL(request.url()).pathname,
      table: requestTable(request),
      startedAt: Date.now(),
    }
    requestTimings.set(request, entry)
    requests.push(entry)
  })
  page.on('requestfinished', (request) => {
    const entry = requestTimings.get(request)
    if (entry) entry.completedAt = Date.now()
  })
  page.on('requestfailed', (request) => {
    const entry = requestTimings.get(request)
    if (!entry) return
    entry.completedAt = Date.now()
    entry.failed = true
  })
  page.on('pageerror', (error) => errors.push(`page:${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console:${message.text()}`)
  })

  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await page.locator('[data-sidebar-settings]').waitFor({ state: 'visible', timeout: 20_000 })
  await page.locator('[data-sidebar-settings]').click()
  await page.locator('[data-global-settings-tab="channels"]').waitFor({ state: 'visible', timeout: 20_000 })

  const measure = async (label, click, waitFor) => {
    const requestOffset = requests.length
    const start = Date.now()
    await click()
    try {
      await page.waitForFunction(waitFor, null, { timeout: 30_000 })
    } catch (error) {
      await page.screenshot({ path: path.join(outDir, `${label}-timeout.png`), fullPage: false })
      const dump = await page.evaluate(() => ({
        used: document.querySelector('[data-storage-count="used"]')?.textContent ?? null,
        projects: document.querySelector('[data-storage-count="projects"]')?.textContent ?? null,
        runLogRows: document.querySelectorAll('[data-run-log-row]').length,
        logPanel: document.querySelector('[data-log-panel]')?.textContent?.slice(0, 200) ?? null,
      }))
      console.error(`measure(${label}) timeout`, JSON.stringify(dump))
      throw error
    }
    const elapsedMs = Date.now() - start
    const measured = requests.slice(requestOffset)
      .filter((entry) => entry.completedAt !== undefined)
      .map((entry) => ({
        method: entry.method,
        path: entry.path,
        table: entry.table,
        elapsedMs: entry.completedAt - entry.startedAt,
        failed: entry.failed === true,
      }))
    const counts = new Map()
    for (const entry of measured) {
      const tablePart = entry.table ? `?table=${entry.table}` : ''
      const key = `${entry.method} ${entry.path}${tablePart}`
      const group = counts.get(key) ?? {
        method: entry.method,
        path: entry.path,
        table: entry.table,
        count: 0,
        maxMs: 0,
        totalMs: 0,
      }
      group.count += 1
      group.maxMs = Math.max(group.maxMs, entry.elapsedMs)
      group.totalMs += entry.elapsedMs
      counts.set(key, group)
    }
    const slowest = [...counts.values()]
      .sort((a, b) => b.maxMs - a.maxMs || b.totalMs - a.totalMs)
      .slice(0, 12)
    const result = { label, elapsedMs, requests: slowest, requestCount: measured.length }
    results.push(result)
    console.log(label, `${elapsedMs}ms`, JSON.stringify(slowest))
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
  await page.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => undefined)
  await context.close()

  const summary = {
    generatedAt: new Date().toISOString(),
    gitHead,
    sourceTree: {
      clean: gitStatus === '',
      status: gitStatus ? gitStatus.split(/\r?\n/) : [],
    },
    build: {
      command: 'npm run build',
      distSha256: distFingerprint.sha256,
      distFiles: distFingerprint.files,
    },
    mode: 'production',
    base,
    storeBase,
    health: { backend: health.backend, version: health.version },
    seed: { projects: projects.length, assets: assets.length, runRecords: runRecords.length },
    results,
    requestTotal: requests.length,
    geometry,
    errors,
  }
  const serialized = JSON.stringify(summary, null, 2)
  writeFileSync(path.join(outDir, 'result.json'), serialized)
  writeFileSync(path.join(outputRoot, 'result.json'), serialized)
  console.log(JSON.stringify(summary, null, 2))
  if (errors.length > 0) process.exitCode = 1
} finally {
  await browser?.close().catch(() => undefined)
  killTree(store)
  killTree(preview)
  await Promise.all([
    new Promise((resolve) => storeStream.end(resolve)),
    new Promise((resolve) => previewStream.end(resolve)),
  ])
}
