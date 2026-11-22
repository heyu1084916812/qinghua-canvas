/* global console, document, fetch, getComputedStyle, localStorage, process, window */
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'
import { seedGraph } from '../../scripts/test-canvas-performance.mjs'

const ROOT = path.resolve(import.meta.dirname, '../..')
const OUT = path.join(ROOT, 'review', '2026-11-22-1180-canvas-drag-background')
const STORE = 'http://127.0.0.1:18765'
const PREFIX = process.argv[2] === 'before' ? 'before' : 'after'
const LEGACY_CSS =
  PREFIX === 'before'
    ? `
      [data-viewport-background='dots'] {
        background-image: radial-gradient(
          circle,
          var(--canvas-grid-line) 0 1.4px,
          transparent 1.4px
        ) !important;
      }
    `
    : null
const COMBINATIONS = [
  { key: '1440-dark', width: 1440, height: 900, theme: 'dark' },
  { key: '1440-light', width: 1440, height: 900, theme: 'light' },
  { key: '1024-dark', width: 1024, height: 700, theme: 'dark' },
  { key: '1024-light', width: 1024, height: 700, theme: 'light' },
]
const baseNodes = seedGraph()
  .nodes.filter((node) => node.type === 'prompt')
  .slice(0, 36)

fs.mkdirSync(OUT, { recursive: true })
const seededProjects = []
const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
})

try {
  const matrix = []
  for (const combo of COMBINATIONS) {
    const projectId = `probe-1180-${PREFIX}-${combo.key}`
    const nodes = baseNodes.map((node) => ({
      ...node,
      id: `${node.id}-${PREFIX}-${combo.key}`,
      projectId,
    }))
    await seedProject(projectId, nodes)
    seededProjects.push({ projectId, nodes })

    const context = await browser.newContext({
      viewport: { width: combo.width, height: combo.height },
      colorScheme: combo.theme,
    })
    await context.addInitScript((theme) => {
      localStorage.setItem('flow:onboarded', '1')
      localStorage.setItem('flow:canvasGuideDismissed', '1')
      localStorage.setItem('flow:theme', theme)
    }, combo.theme)
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })

    await page.goto(`http://127.0.0.1:1420/canvas/${projectId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    })
    await page.locator('[data-canvas-hydrated="true"]').waitFor({ timeout: 60_000 })
    await page.waitForFunction(
      (expected) => document.querySelectorAll('.react-flow__node[data-id]').length >= expected,
      nodes.length,
      { timeout: 60_000 },
    )
    if (LEGACY_CSS) await page.addStyleTag({ content: LEGACY_CSS })
    await page.waitForTimeout(500)

    const before = await captureState(
      page,
      `${PREFIX}-${combo.key}-before.png`,
    )
    const pan = await capturePan(
      page,
      `${PREFIX}-${combo.key}-pan.png`,
      nodes.length,
    )
    const drag = await captureNodeDrag(
      page,
      `${PREFIX}-${combo.key}-node-drag.png`,
      nodes.length,
    )
    matrix.push({ ...combo, before, pan, drag, errors })
    await context.close()
  }

  fs.writeFileSync(
    path.join(OUT, `matrix-${PREFIX}.json`),
    JSON.stringify({ prefix: PREFIX, matrix }, null, 2),
  )
  console.log(JSON.stringify({ prefix: PREFIX, matrix }, null, 2))
} finally {
  await browser.close()
  for (const project of seededProjects) {
    for (const node of project.nodes) {
      await post('/delete', { table: 'nodes', id: node.id })
    }
    await post('/delete', { table: 'projects', id: project.projectId })
  }
}

async function seedProject(projectId, nodes) {
  await post('/put', {
    table: 'projects',
    row: {
      id: projectId,
      workbench: 'canvas',
      name: `画布拖动背景复验 ${PREFIX}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      thumbnail: null,
      extra: {},
    },
  })
  await post('/bulkPut', { table: 'nodes', rows: nodes })
}

async function captureState(page, screenshot) {
  await page.screenshot({ path: path.join(OUT, screenshot) })
  return page.evaluate(() => {
    const surface = document.querySelector('[data-canvas-surface]')
    const background = document.querySelector('.react-flow__background')
    const dot = background?.querySelector('circle')
    const viewport = document.querySelector('.react-flow__viewport')
    const surfaceStyle = surface ? getComputedStyle(surface) : null
    return {
      theme: document.documentElement.dataset.theme ?? null,
      moving: surface?.getAttribute('data-viewport-moving') ?? null,
      backgroundMode: surface?.getAttribute('data-canvas-background') ?? null,
      tone: surface?.getAttribute('data-canvas-tone') ?? null,
      surfaceBackground: surfaceStyle?.backgroundColor ?? null,
      surfaceDot: surfaceStyle?.getPropertyValue('--canvas-grid-line').trim() ?? null,
      viewportTransform: viewport?.getAttribute('style') ?? null,
      backgroundDisplay: background ? getComputedStyle(background).display : null,
      dotRadius: dot?.getAttribute('r') ?? null,
      dotFill: dot ? getComputedStyle(dot).fill : null,
    }
  })
}

async function capturePan(page, screenshot, expectedNodes) {
  const surface = await page.locator('[data-canvas-surface]').boundingBox()
  const point = await blankPointerPoint(page, surface)
  await page.mouse.move(point.x, point.y)
  await page.mouse.down({ button: 'middle' })
  await page.mouse.move(point.x + 180, point.y + 90, { steps: 8 })
  await page.waitForTimeout(80)
  const state = await captureGestureState(page, screenshot)
  await page.mouse.up({ button: 'middle' })
  await page.waitForFunction(
    (expected) => document.querySelectorAll('.react-flow__node[data-id]').length === expected,
    expectedNodes,
    { timeout: 10_000 },
  )
  return state
}

async function captureNodeDrag(page, screenshot, expectedNodes) {
  const node = await draggableNode(page)
  await page.mouse.move(node.x, node.y)
  await page.mouse.down()
  await page.mouse.move(node.x + 120, node.y + 60, { steps: 8 })
  await page.waitForTimeout(80)
  const state = await captureGestureState(page, screenshot)
  await page.mouse.up()
  await page.waitForFunction(
    (expected) => document.querySelectorAll('.react-flow__node[data-id]').length === expected,
    expectedNodes,
    { timeout: 10_000 },
  )
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(250)
  return state
}

async function captureGestureState(page, screenshot) {
  await page.screenshot({ path: path.join(OUT, screenshot) })
  return page.evaluate(() => {
    const surface = document.querySelector('[data-canvas-surface]')
    const fastBackground = document.querySelector('[data-viewport-background]')
    const background = document.querySelector('.react-flow__background')
    const viewport = document.querySelector('.react-flow__viewport')
    const style = fastBackground ? getComputedStyle(fastBackground) : null
    return {
      moving: surface?.getAttribute('data-viewport-moving') === 'true',
      fastBackground: fastBackground?.getAttribute('data-viewport-background') ?? null,
      fastBackgroundSize: style?.backgroundSize ?? null,
      fastBackgroundPosition: style?.backgroundPosition ?? null,
      fastBackgroundImage: style?.backgroundImage ?? null,
      fastPatternSize: style?.getPropertyValue('--viewport-pattern-size').trim() ?? null,
      fastPatternPosition: style?.getPropertyValue('--viewport-pattern-position').trim() ?? null,
      fastMaskSize: style?.getPropertyValue('mask-size') || style?.webkitMaskSize || null,
      fastMaskImage: style?.getPropertyValue('mask-image') || style?.webkitMaskImage || null,
      fastBackgroundColor: style?.backgroundColor ?? null,
      normalBackgroundDisplay: background ? getComputedStyle(background).display : null,
      viewportTransform: viewport?.getAttribute('style') ?? null,
      mountedNodes: document.querySelectorAll('.react-flow__node[data-id]').length,
    }
  })
}

async function blankPointerPoint(page, bounds) {
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
  if (!point) throw new Error('no blank pane point')
  return point
}

async function draggableNode(page) {
  const node = await page.evaluate(() => {
    for (const wrapper of document.querySelectorAll('.react-flow__node[data-id]')) {
      const rect = wrapper.getBoundingClientRect()
      if (
        rect.left < 120 ||
        rect.right > window.innerWidth - 120 ||
        rect.top < 120 ||
        rect.bottom > window.innerHeight - 160
      ) {
        continue
      }
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      }
    }
    return null
  })
  if (!node) throw new Error('no draggable node')
  return node
}

async function post(route, body) {
  const response = await fetch(`${STORE}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`${route}: ${await response.text()}`)
}
