#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'
import {
  PERFORMANCE_PROJECT_ID,
  seedGraph,
} from './test-canvas-performance.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')
const storePort = Number(process.env.QH_PERF_STORE_PORT ?? 18772)
const cdpPort = Number(process.env.QH_PERF_CDP_PORT ?? 9445)
const reportPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(ROOT, '.playwright-verify', 'canvas-image-diagnosis.json')

if (!reportPath.startsWith(path.join(ROOT, '.playwright-verify') + path.sep)) {
  throw new Error('diagnosis report must stay inside .playwright-verify')
}
if (!fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) {
  throw new Error('dist/index.html missing')
}

const seeded = seedGraph()

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`${url} failed: ${await response.text()}`)
  return response.json()
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return response.text()
    } catch {
      // CDP or shared-store might still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`timed out waiting for ${url}`)
}

function percentile(values, ratio = 0.95) {
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)
  return sorted[Math.max(0, index)]
}

async function waitForCanvasImages(page) {
  await page.locator('[data-canvas-hydrated="true"]').waitFor({ timeout: 60_000 })
  await page.waitForFunction(
    () => document.querySelectorAll('[data-node-type="generation"] img').length >= 150,
    null,
    { timeout: 90_000 },
  )
  await page.evaluate(() => Promise.all(
    Array.from(document.images).map((image) => image.decode?.().catch(() => undefined)),
  ))
}

async function measure(page, label, css) {
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 })
  await waitForCanvasImages(page)
  const style = await page.addStyleTag({ content: css })
  const surface = await page.locator('[data-canvas-surface]').boundingBox()
  if (!surface) throw new Error('canvas surface has no bounding box')
  const x = surface.x + surface.width * 0.55
  const y = surface.y + surface.height * 0.5
  await page.mouse.move(x, y)
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
    1200,
  )
  for (let index = 0; index < 24; index += 1) {
    await page.mouse.wheel(0, index % 2 === 0 ? -360 : 360)
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  const intervals = await sampling
  await style.evaluate((element) => element.remove())
  return {
    label,
    p95Ms: percentile(intervals),
    averageMs: intervals.reduce((total, value) => total + value, 0) / intervals.length,
    frames: intervals.length,
  }
}

async function measureWithTransformProbe(page) {
  const styles = [
    ['node content hidden', '.react-flow__node :is(*:not(img)) { visibility: hidden !important; }'],
    ['node content hidden except media', '.react-flow__node :is(*:not(img)) { visibility: hidden !important; } .react-flow__node img { visibility: visible !important; }'],
    ['node contain strict', '.react-flow__node { contain: strict !important; }'],
    ['node will change transform', '.react-flow__node { will-change: transform !important; }'],
    ['node flat rendering', '.react-flow__node { isolation: isolate !important; transform: translateZ(0) !important; }'],
    ['will change plus layout style contain', '.react-flow__node { will-change: transform !important; contain: layout style !important; }'],
    ['will change plus backface hidden', '.react-flow__node { will-change: transform !important; backface-visibility: hidden !important; }'],
    ['node content visibility auto', '.react-flow__node { content-visibility: auto !important; contain-intrinsic-size: 240px 160px !important; }'],
    ['content visibility plus will change', '.react-flow__node { content-visibility: auto !important; contain-intrinsic-size: 240px 160px !important; will-change: transform !important; }'],
  ]
  const rounds = []
  for (const [label, css] of styles) rounds.push(await measure(page, label, css))
  return rounds
}

await waitForHttp(`http://127.0.0.1:${storePort}/health`, 30_000)
await postJson(`http://127.0.0.1:${storePort}/put`, {
  table: 'projects',
  row: {
    id: PERFORMANCE_PROJECT_ID,
    workbench: 'canvas',
    name: '真实图片性能诊断',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    thumbnail: null,
    extra: {},
  },
})
await postJson(`http://127.0.0.1:${storePort}/bulkPut`, { table: 'assets', rows: seeded.assets })
await postJson(`http://127.0.0.1:${storePort}/bulkPut`, { table: 'nodes', rows: seeded.nodes })
await postJson(`http://127.0.0.1:${storePort}/bulkPut`, { table: 'edges', rows: seeded.edges })
await waitForHttp(`http://127.0.0.1:${cdpPort}/json/version`, 30_000)

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`)
try {
  const context = browser.contexts()[0]
  const page = context.pages()[0] ?? (await context.waitForEvent('page'))
  await page.waitForURL(/tauri\.localhost/, { timeout: 30_000 })
  await page.evaluate(() => {
    localStorage.setItem('flow:onboarded', '1')
    localStorage.setItem('flow:canvasGuideDismissed', '1')
    localStorage.setItem('flow:theme', 'light')
  })
  await page.goto(`http://tauri.localhost/canvas/${PERFORMANCE_PROJECT_ID}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  })
  await waitForCanvasImages(page)
  const baseline = {
    nodes: await page.locator('[data-node-id]').count(),
    images: await page.locator('[data-node-type="generation"] img').count(),
    decoded: await page.locator('[data-node-type="generation"] img').evaluateAll((images) =>
      images.filter((image) => image.complete && image.naturalWidth > 0).length,
    ),
  }
  const rounds = []
  rounds.push(await measure(page, 'baseline', '/* baseline */'))
  rounds.push(await measure(page, 'images visibility hidden', '[data-node-type="generation"] img{visibility:hidden!important}'))
  rounds.push(await measure(page, 'images display none', '[data-node-type="generation"] img{display:none!important}'))
  rounds.push(await measure(page, 'nodes visibility hidden', '.react-flow__node{visibility:hidden!important}'))
  rounds.push(...await measureWithTransformProbe(page))
  const report = { ok: true, baseline, rounds, note: 'diagnosis only; display:none results are not acceptance evidence' }
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally {
  await browser.close().catch(() => undefined)
}
