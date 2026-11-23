/* global DOMMatrix, console, document, fetch, getComputedStyle, innerHeight, innerWidth, localStorage, location, performance, requestAnimationFrame */
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'
import { seedGraph } from '../../scripts/test-canvas-performance.mjs'

const ROOT = path.resolve(import.meta.dirname, '../..')
const OUT = path.join(ROOT, 'review', '2026-11-23-1181-canvas-gesture-stress')
const STORE = 'http://127.0.0.1:18765'
const APP = 'http://127.0.0.1:1420'
const PROJECT = `stress-1181-${Date.now()}`
const seeded = seedGraph()
const project = {
  id: PROJECT,
  workbench: 'canvas',
  name: '长手势压力分析',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  thumbnail: null,
  extra: {},
}

fs.mkdirSync(OUT, { recursive: true })
await post('/put', { table: 'projects', row: project })
await post('/bulkPut', { table: 'assets', rows: seeded.assets })
await post('/bulkPut', { table: 'nodes', rows: seeded.nodes })
await post('/bulkPut', { table: 'edges', rows: seeded.edges })

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
})

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await context.addInitScript(() => {
    localStorage.setItem('flow:onboarded', '1')
    localStorage.setItem('flow:canvasGuideDismissed', '1')
    localStorage.setItem('flow:theme', 'dark')
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.goto(`${APP}/canvas/${PROJECT}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  })
  await page.locator('[data-canvas-hydrated="true"]').waitFor({ timeout: 60_000 })
  await page.waitForTimeout(5000)
  const debugState = await page.evaluate(() => ({
    url: location.href,
    nodes: document.querySelectorAll('.react-flow__node[data-id]').length,
    nodeIds: [...document.querySelectorAll('.react-flow__node[data-id]')]
      .slice(0, 5)
      .map((node) => node.getAttribute('data-id')),
    images: document.querySelectorAll('[data-node-type="generation"] img').length,
    text: document.body.textContent?.slice(0, 300) ?? '',
  }))
  if (debugState.nodes !== 300) {
    await page.screenshot({ path: path.join(OUT, 'load-failed.png') })
    throw new Error(`project did not mount 300 nodes: ${JSON.stringify({ debugState, errors })}`)
  }
  await page.waitForFunction(
    () => document.querySelectorAll('[data-node-type="generation"] img').length >= 150,
    undefined,
    { timeout: 60_000 },
  )
  await page.waitForTimeout(800)

  const initial = await viewportEvidence(page)
  const pan = await longPan(page)
  const drag = await longNodeDrag(page)
  const zoom = await longZoom(page)
  const after = await viewportEvidence(page)
  const report = { initial, pan, drag, zoom, after, errors }
  fs.writeFileSync(path.join(OUT, 'stress-report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  await context.close()
} finally {
  await browser.close()
  for (const edge of seeded.edges) await post('/delete', { table: 'edges', id: edge.id })
  for (const node of seeded.nodes) await post('/delete', { table: 'nodes', id: node.id })
  for (const asset of seeded.assets) await post('/delete', { table: 'assets', id: asset.id })
  await post('/delete', { table: 'projects', id: PROJECT })
}

async function longPan(page) {
  const surface = await page.locator('[data-canvas-surface]').boundingBox()
  const point = await blankPoint(page, surface)
  const startX = point.x
  const y = point.y
  await page.mouse.move(startX, y)
  await page.mouse.down({ button: 'middle' })
  const intervals = await sampleFrames(page, async () => {
    for (let cycle = 0; cycle < 3; cycle += 1) {
      await page.mouse.move(surface.x + surface.width * 0.86, y, { steps: 28 })
      await page.waitForTimeout(80)
      await page.mouse.move(surface.x + surface.width * 0.22, y, { steps: 28 })
      await page.waitForTimeout(80)
    }
  })
  await page.screenshot({ path: path.join(OUT, 'pan-long-active.png') })
  const during = await viewportEvidence(page)
  await page.mouse.up({ button: 'middle' })
  await page.waitForFunction(
    () => document.querySelectorAll('.react-flow__node[data-id]').length === 300,
    { timeout: 10_000 },
  )
  return { intervals: frameStats(intervals), during }
}

async function longNodeDrag(page) {
  const node = await visibleImageNode(page)
  const start = { x: node.x, y: node.y }
  const startRect = await page.locator(`.react-flow__node[data-id="${node.id}"]`).boundingBox()
  const lagSamples = []
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  const intervals = await sampleFrames(page, async () => {
    for (let cycle = 0; cycle < 3; cycle += 1) {
      for (let step = 1; step <= 24; step += 1) {
        const dx = step * 26
        await page.mouse.move(start.x + dx, start.y + step * 8)
        const rect = await afterFrameRect(page, node.id)
        lagSamples.push(pointerLag(startRect, start, rect, start.x + dx, start.y + step * 8))
      }
      for (let step = 23; step >= 0; step -= 1) {
        const dx = step * 26
        await page.mouse.move(start.x + dx, start.y + step * 8)
        const rect = await afterFrameRect(page, node.id)
        lagSamples.push(pointerLag(startRect, start, rect, start.x + dx, start.y + step * 8))
      }
    }
  })
  await page.screenshot({ path: path.join(OUT, 'node-drag-long-active.png') })
  const during = await page.evaluate(() => ({
    moving: document.querySelector('[data-canvas-surface]')?.getAttribute('data-viewport-moving') ?? null,
    portLayer: Boolean(document.querySelector('[data-flow-port-layer]')),
    childHitLayer: Boolean(document.querySelector('[data-flow-child-edge-hit]')),
    movingNodes: document.querySelectorAll('.react-flow__node.dragging').length,
  }))
  await page.mouse.up()
  await page.waitForFunction(
    () => document.querySelectorAll('.react-flow__node[data-id]').length === 300,
    { timeout: 10_000 },
  )
  await page.waitForTimeout(300)
  return {
    nodeId: node.id,
    intervals: frameStats(intervals),
    lag: {
      samples: lagSamples.length,
      mean: average(lagSamples.map((sample) => sample.distance)),
      p95: percentile(lagSamples.map((sample) => sample.distance), 0.95),
      max: Math.max(...lagSamples.map((sample) => sample.distance)),
      maxX: Math.max(...lagSamples.map((sample) => Math.abs(sample.x))),
      maxY: Math.max(...lagSamples.map((sample) => Math.abs(sample.y))),
    },
    during,
  }
}

async function longZoom(page) {
  const surface = await page.locator('[data-canvas-surface]').boundingBox()
  const point = await blankPoint(page, surface)
  await page.mouse.move(point.x, point.y)
  const intervals = await sampleFrames(page, async () => {
    for (let index = 0; index < 28; index += 1) {
      await page.mouse.wheel(0, 120)
      await page.waitForTimeout(35)
    }
    for (let index = 0; index < 34; index += 1) {
      await page.mouse.wheel(0, -120)
      await page.waitForTimeout(35)
    }
  })
  const during = await viewportEvidence(page)
  await page.waitForTimeout(500)
  const settled = await viewportEvidence(page)
  return { intervals: frameStats(intervals), during, settled }
}

async function afterFrameRect(page, nodeId) {
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  return page.locator(`.react-flow__node[data-id="${nodeId}"]`).boundingBox()
}

function pointerLag(startRect, startPointer, rect, pointerX, pointerY) {
  if (!startRect || !rect) return { x: Number.POSITIVE_INFINITY, y: Number.POSITIVE_INFINITY, distance: Number.POSITIVE_INFINITY }
  const x = rect.x - startRect.x - (pointerX - startPointer.x)
  const y = rect.y - startRect.y - (pointerY - startPointer.y)
  return { x, y, distance: Math.hypot(x, y) }
}

async function sampleFrames(page, action) {
  const sampling = page.evaluate(
    () =>
      new Promise((resolve) => {
        const intervals = []
        let previous = performance.now()
        const started = previous
        const tick = (now) => {
          intervals.push(now - previous)
          previous = now
          if (now - started >= 6000) resolve(intervals.slice(1))
          else requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      }),
  )
  await action()
  return sampling
}

function frameStats(intervals) {
  const sorted = [...intervals].sort((a, b) => a - b)
  return {
    frames: intervals.length,
    mean: average(intervals),
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: Math.max(...intervals),
    over20: intervals.filter((value) => value > 20).length,
    over33: intervals.filter((value) => value > 33).length,
  }
}

function percentile(values, ratio) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] ?? 0
}

function average(values) {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length
}

async function viewportEvidence(page) {
  return page.evaluate(() => {
    const viewport = document.querySelector('.react-flow__viewport')
    const matrix = new DOMMatrix(getComputedStyle(viewport).transform)
    const visibleImages = [...document.querySelectorAll('[data-node-type="generation"] img')].filter(
      (image) => {
        const rect = image.getBoundingClientRect()
        return rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight
      },
    ).length
    return {
      zoom: matrix.a,
      x: matrix.e,
      y: matrix.f,
      mountedNodes: document.querySelectorAll('.react-flow__node[data-id]').length,
      visibleImages,
      moving: document.querySelector('[data-canvas-surface]')?.getAttribute('data-viewport-moving') ?? null,
    }
  })
}

async function visibleImageNode(page) {
  const node = await page.evaluate(() => {
    for (const wrapper of document.querySelectorAll('[data-node-type="generation"]')) {
      const rect = wrapper.getBoundingClientRect()
      if (
        rect.left < 80 ||
        rect.right > innerWidth - 400 ||
        rect.top < 140 ||
        rect.bottom > innerHeight - 180
      ) {
        continue
      }
      const flowNode = wrapper.closest('.react-flow__node[data-id]')
      if (!flowNode) continue
      return {
        id: flowNode.getAttribute('data-id'),
        x: rect.left + Math.min(40, rect.width / 2),
        y: rect.top + Math.min(40, rect.height / 2),
      }
    }
    return null
  })
  if (!node) throw new Error('no visible image node')
  return node
}

async function blankPoint(page, bounds) {
  const point = await page.evaluate((surface) => {
    for (let row = 0; row <= 20; row += 1) {
      for (let column = 0; column <= 24; column += 1) {
        const x = surface.x + surface.width * ((column + 0.5) / 25)
        const y = surface.y + surface.height * ((row + 0.5) / 21)
        const target = document.elementFromPoint(x, y)
        if (!target?.closest('.react-flow__pane')) continue
        if (target.closest('[data-node-id], [data-flow-hud], [data-canvas-minimap]')) continue
        return { x, y }
      }
    }
    return null
  }, bounds)
  if (!point) throw new Error('no blank point')
  return point
}

async function post(route, body) {
  const response = await fetch(`${STORE}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`${route}: ${await response.text()}`)
}
