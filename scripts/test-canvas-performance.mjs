#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'

if (process.platform !== 'win32') {
  console.log('canvas release performance gate skipped: Windows WebView2 release shell is required')
  process.exit(0)
}

const root = path.resolve(import.meta.dirname, '..')
const dist = path.join(root, 'dist', 'index.html')
const releaseExe = process.env.QH_PERF_RELEASE_EXE
  ? path.resolve(process.env.QH_PERF_RELEASE_EXE)
  : path.join(root, 'src-tauri', 'target', 'release', 'qinghua.exe')
const storePort = Number(process.env.QH_PERF_STORE_PORT ?? 18772)
const cdpPort = Number(process.env.QH_PERF_CDP_PORT ?? 9445)
const runRoot = path.join(
  root,
  '.playwright-verify',
  `canvas-perf-release-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`,
)
const dataDir = path.join(runRoot, 'product', 'data-v2')
const localAppData = path.join(runRoot, 'localappdata')
const reportPath = path.join(runRoot, 'report.json')
const markdownPath = path.join(runRoot, 'REPORT.md')
const projectId = 'perf-release-300-500'

if (!fs.existsSync(dist)) {
  throw new Error('dist/index.html missing; run npm run build before the release performance gate')
}
if (!fs.existsSync(releaseExe)) {
  throw new Error(`release executable missing: ${releaseExe}; run npm run tauri build first`)
}
if (fs.statSync(releaseExe).mtimeMs + 1000 < fs.statSync(dist).mtimeMs) {
  throw new Error(
    `release executable is older than dist (${releaseExe}); rebuild the desktop release before measuring`,
  )
}
fs.mkdirSync(dataDir, { recursive: true })
fs.mkdirSync(localAppData, { recursive: true })

const appLog = fs.openSync(path.join(runRoot, 'app.log'), 'w')
let app

async function waitForHttp(url, timeoutMs, validate = () => true) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) {
        const body = await response.text()
        if (validate(body)) return body
      }
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`timed out waiting for ${url}: ${String(lastError ?? '')}`)
}

async function put(table, row) {
  const response = await fetch(`http://127.0.0.1:${storePort}/put`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ table, row }),
  })
  if (!response.ok) throw new Error(`${table} put failed: ${await response.text()}`)
}

async function bulkPut(table, rows) {
  const response = await fetch(`http://127.0.0.1:${storePort}/bulkPut`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ table, rows }),
  })
  if (!response.ok) throw new Error(`${table} bulkPut failed: ${await response.text()}`)
}

function seedGraph() {
  const now = Date.now()
  const nodes = []
  const edges = []
  const types = []
  const ids = []
  const columns = 20
  for (let index = 0; index < 300; index += 1) {
    const type = index % 2 === 0 ? 'prompt' : 'generation'
    const id = `perf-node-${String(index).padStart(3, '0')}`
    const column = index % columns
    const row = Math.floor(index / columns)
    types.push(type)
    ids.push(id)
    nodes.push({
      id,
      projectId,
      type,
      parentId: null,
      x: 40 + column * 240,
      y: 40 + row * 200,
      w: 240,
      h: type === 'prompt' ? 160 : 192,
      title: type === 'prompt' ? `性能提示词 ${index}` : `性能生成 ${index}`,
      disabled: false,
      data:
        type === 'prompt'
          ? {
              text: `性能样本 ${index}`,
              upstreamPromptLinked: false,
              channelId: '',
              model: '',
            }
          : {
              mode: 'image',
              prompt: '',
              linkedPromptNodeIds: [],
              channelId: '',
              model: '',
              thumbOrder: [],
              upstreamHidden: [],
            },
      updatedAt: now,
    })
  }
  const seen = new Set()
  outer: for (let span = 1; span <= 4; span += 1) {
    for (let index = 0; index < 300; index += 1) {
      const targetIndex = (index + span) % 300
      if (types[targetIndex] !== 'generation') continue
      if (index + span >= 300) continue
      const source = ids[index]
      const target = ids[targetIndex]
      const key = `${source}>${target}`
      if (seen.has(key)) continue
      seen.add(key)
      edges.push({
        id: `perf-edge-${String(edges.length).padStart(3, '0')}`,
        projectId,
        source,
        target,
      })
      if (edges.length >= 500) break outer
    }
  }
  return { nodes, edges }
}

function percentile(values, ratio) {
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)
  return sorted[Math.max(0, index)]
}

async function sampleFrames(page, action, durationMs = 1200) {
  const sampling = page.evaluate(
    (duration) =>
      new Promise((resolve) => {
        const intervals = []
        let previous = performance.now()
        const started = previous
        const tick = (now) => {
          intervals.push(now - previous)
          previous = now
          if (now - started >= duration) resolve(intervals.slice(1))
          else requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      }),
    durationMs,
  )
  await action()
  return sampling
}

async function panRound(page) {
  const surface = await page.locator('[data-canvas-surface]').boundingBox()
  if (!surface) throw new Error('canvas surface has no bounding box')
  const x = surface.x + surface.width * 0.55
  const y = surface.y + surface.height * 0.5
  await page.keyboard.down('Space')
  await page.mouse.move(x, y)
  await page.mouse.down()
  const intervals = await sampleFrames(page, async () => {
    for (let index = 0; index < 24; index += 1) {
      const direction = index % 2 === 0 ? 1 : -1
      await page.mouse.move(x + direction * 260, y + direction * 90, { steps: 4 })
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  })
  await page.mouse.up()
  await page.keyboard.up('Space')
  return intervals
}

async function zoomRound(page) {
  const surface = await page.locator('[data-canvas-surface]').boundingBox()
  if (!surface) throw new Error('canvas surface has no bounding box')
  const x = surface.x + surface.width * 0.55
  const y = surface.y + surface.height * 0.5
  await page.mouse.move(x, y)
  return sampleFrames(page, async () => {
    for (let index = 0; index < 24; index += 1) {
      await page.mouse.wheel(0, index % 2 === 0 ? -360 : 360)
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  })
}

let browser
try {
  app = spawn(releaseExe, [], {
    cwd: path.dirname(releaseExe),
    env: {
      ...process.env,
      LOCALAPPDATA: localAppData,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: [
        `--remote-debugging-port=${cdpPort}`,
        '--no-proxy-server',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
      ].join(' '),
      QINGHUA_RELEASE_GATE: '1',
      QINGHUA_RELEASE_GATE_DATA_DIR: dataDir,
      QINGHUA_SHARED_STORE_PORT: String(storePort),
    },
    stdio: ['ignore', appLog, appLog],
  })
  await waitForHttp(
    `http://127.0.0.1:${storePort}/health`,
    30_000,
    (body) => JSON.parse(body).service === 'qinghua-shared-store',
  )

  const { nodes, edges } = seedGraph()
  await put('projects', {
    id: projectId,
    workbench: 'canvas',
    name: 'Release 性能门禁 300/500',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    thumbnail: null,
    extra: {},
  })
  await bulkPut('nodes', nodes)
  await bulkPut('edges', edges)

  await waitForHttp(`http://127.0.0.1:${cdpPort}/json/version`, 30_000)
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`)
  const context = browser.contexts()[0]
  const page = context.pages()[0] ?? (await context.waitForEvent('page'))
  await page.waitForURL(/tauri\.localhost/, { timeout: 30_000 })
  await page.evaluate(() => {
    localStorage.setItem('flow:onboarded', '1')
    localStorage.setItem('flow:canvasGuideDismissed', '1')
    localStorage.setItem('flow:theme', 'light')
  })
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.goto(`http://tauri.localhost/canvas/${projectId}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  })
  await page.locator('[data-canvas-hydrated="true"]').waitFor({ timeout: 60_000 })
  await page.waitForFunction(
    () => document.querySelectorAll('[data-node-id]').length >= 300,
    null,
    { timeout: 60_000 },
  )
  await page.waitForTimeout(1500)
  const mountedNodes = await page.locator('[data-node-id]').count()
  const mountedEdges = await page.locator('.react-flow__edge').count()

  // Hydration and first-use setup are not part of steady-state frame measurements.
  await panRound(page)
  await zoomRound(page)
  await page.waitForTimeout(500)

  const panRounds = []
  const zoomRounds = []
  for (let round = 0; round < 3; round += 1) {
    const intervals = await panRound(page)
    panRounds.push({
      p95Ms: percentile(intervals, 0.95),
      averageMs:
        intervals.reduce((total, value) => total + value, 0) / Math.max(1, intervals.length),
      frames: intervals.length,
    })
    await page.waitForTimeout(250)
  }
  for (let round = 0; round < 3; round += 1) {
    const intervals = await zoomRound(page)
    zoomRounds.push({
      p95Ms: percentile(intervals, 0.95),
      averageMs:
        intervals.reduce((total, value) => total + value, 0) / Math.max(1, intervals.length),
      frames: intervals.length,
    })
    await page.waitForTimeout(250)
  }

  const report = {
    ok:
      mountedNodes === 300 &&
      mountedEdges >= 500 &&
      pageErrors.length === 0 &&
      panRounds.every((round) => round.p95Ms <= 20) &&
      zoomRounds.every((round) => round.p95Ms <= 20),
    environment: {
      built: 'Tauri release + WebView2',
      viewport: '1440x900',
      browser: 'installed WebView2',
      store: 'isolated sqlite-v2 on port ' + storePort,
      releaseExe,
    },
    graph: { nodes: nodes.length, edges: edges.length, mountedNodes, mountedEdges },
    panRounds,
    zoomRounds,
    pageErrors,
  }
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
  fs.writeFileSync(
    markdownPath,
    [
      '# Canvas release performance gate',
      '',
      `Status: **${report.ok ? 'PASS' : 'FAIL'}**`,
      '',
      `- graph: ${nodes.length} nodes / ${edges.length} edges; mounted ${mountedNodes} nodes / ${mountedEdges} edges`,
      `- environment: ${report.environment.built}, ${report.environment.viewport}, ${report.environment.browser}`,
      `- pan P95: ${panRounds.map((round) => round.p95Ms.toFixed(2) + 'ms').join(' / ')}`,
      `- zoom P95: ${zoomRounds.map((round) => round.p95Ms.toFixed(2) + 'ms').join(' / ')}`,
      `- page errors: ${pageErrors.length}`,
      '',
    ].join('\n'),
  )
  console.log(JSON.stringify(report, null, 2))
  console.log(`evidence: ${path.relative(root, reportPath)}`)
  if (!report.ok) process.exitCode = 1
} finally {
  await browser?.close().catch(() => {})
  if (app?.pid) {
    spawnSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], {
      stdio: 'ignore',
    })
  }
  fs.closeSync(appLog)
}
