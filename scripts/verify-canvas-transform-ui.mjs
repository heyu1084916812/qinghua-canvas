#!/usr/bin/env node
/**
 * UI gate evidence for canvas node transform compositing.
 * Captures 1440x900 / 1024x700 x light/dark before and after with a temporary
 * style override. It does not change source files or shared user data.
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'

const ROOT = path.resolve(import.meta.dirname, '..')
const cdpPort = Number(process.env.QH_UI_CDP_PORT ?? 9445)
const storePort = Number(process.env.QH_UI_STORE_PORT ?? 18772)
const output = path.join(ROOT, '.playwright-verify', 'canvas-transform-ui')
fs.mkdirSync(output, { recursive: true })

const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1024x700', width: 1024, height: 700 },
]
const THEMES = ['light', 'dark']
const PROJECT_ID = 'canvas-transform-ui'

async function put(table, row) {
  const response = await fetch(`http://127.0.0.1:${storePort}/put`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ table, row }),
  })
  if (!response.ok) throw new Error(`${table} put failed: ${await response.text()}`)
}

async function seed() {
  const nodes = []
  for (let i = 0; i < 12; i += 1) {
    nodes.push({
      id: `ui-node-${i}`,
      projectId: PROJECT_ID,
      type: i % 3 === 0 ? 'generation' : 'prompt',
      parentId: null,
      x: 80 + (i % 4) * 260,
      y: 80 + Math.floor(i / 4) * 220,
      w: 240,
      h: 160,
      title: i % 3 === 0 ? `生成节点 ${i}` : `提示词节点 ${i}`,
      disabled: false,
      data: i % 3 === 0
        ? { mode: 'image', prompt: '', linkedPromptNodeIds: [], channelId: '', model: '', thumbOrder: [], upstreamHidden: [] }
        : { text: `UI 门禁样本 ${i}`, upstreamPromptLinked: false, channelId: '', model: '' },
      updatedAt: Date.now(),
    })
  }
  await put('projects', {
    id: PROJECT_ID,
    workbench: 'canvas',
    name: '合成层 UI 门禁',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    thumbnail: null,
    extra: {},
  })
  for (const node of nodes) await put('nodes', node)
}

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

function geometryProbe() {
  return {
    viewport: { width: innerWidth, height: innerHeight },
    nodes: [...document.querySelectorAll('.react-flow__node')].map((node) => {
      const rect = node.getBoundingClientRect()
      return {
        id: node.getAttribute('data-id'),
        x: Number(rect.x.toFixed(2)),
        y: Number(rect.y.toFixed(2)),
        width: Number(rect.width.toFixed(2)),
        height: Number(rect.height.toFixed(2)),
        contentVisibility: getComputedStyle(node).contentVisibility,
      }
    }),
    overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    nodeTextOverflow: [...document.querySelectorAll('.react-flow__node *')]
      .filter((element) => element instanceof HTMLElement && element.scrollWidth > element.clientWidth + 1)
      .length,
    pageErrors: 0,
  }
}

async function capture(page, prefix, viewport, theme, contentVisibility) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height })
  await page.evaluate((nextTheme) => localStorage.setItem('flow:theme', nextTheme), theme)
  await page.goto(`http://tauri.localhost/canvas/${PROJECT_ID}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  })
  await page.locator('[data-canvas-hydrated="true"]').waitFor({ timeout: 60_000 })
  await page.addStyleTag({
    content: `.react-flow__node { content-visibility: ${contentVisibility ? 'auto' : 'visible'} !important; contain-intrinsic-size: auto 240px 160px !important; }`,
  })
  await page.waitForTimeout(300)
  const geometry = await page.evaluate(geometryProbe)
  const screenshot = path.join(output, `${prefix}-${viewport.name}-${theme}.png`)
  const screenshotBuffer = await page.screenshot()
  fs.writeFileSync(screenshot, screenshotBuffer)
  return {
    geometry: { ...geometry, screenshot: path.relative(ROOT, screenshot) },
    screenshotBuffer,
  }
}

async function compareScreenshots(page, beforeBuffer, afterBuffer) {
  return page.evaluate(async ({ before, after }) => {
    const load = async (base64) => {
      const blob = await fetch(`data:image/png;base64,${base64}`).then((response) => response.blob())
      const bitmap = await createImageBitmap(blob)
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
      const context = canvas.getContext('2d', { willReadFrequently: true })
      context.drawImage(bitmap, 0, 0)
      return {
        width: bitmap.width,
        height: bitmap.height,
        pixels: context.getImageData(0, 0, bitmap.width, bitmap.height).data,
      }
    }
    const [left, right] = await Promise.all([load(before), load(after)])
    if (left.width !== right.width || left.height !== right.height) {
      return { sameSize: false, diffPixels: -1, ratio: 1, over20: -1, maxChannelDiff: 255 }
    }
    let diffPixels = 0
    let over20 = 0
    let maxChannelDiff = 0
    let minX = left.width
    let minY = left.height
    let maxX = -1
    let maxY = -1
    for (let y = 0; y < left.height; y += 1) {
      for (let x = 0; x < left.width; x += 1) {
        const offset = (y * left.width + x) * 4
        const delta = Math.max(
          Math.abs(left.pixels[offset] - right.pixels[offset]),
          Math.abs(left.pixels[offset + 1] - right.pixels[offset + 1]),
          Math.abs(left.pixels[offset + 2] - right.pixels[offset + 2]),
        )
        if (delta === 0) continue
        diffPixels += 1
        if (delta > 20) over20 += 1
        maxChannelDiff = Math.max(maxChannelDiff, delta)
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
    }
    return {
      sameSize: true,
      diffPixels,
      ratio: diffPixels / (left.width * left.height),
      over20,
      maxChannelDiff,
      changedRegion: diffPixels > 0 ? { minX, minY, maxX, maxY } : null,
    }
  }, {
    before: beforeBuffer.toString('base64'),
    after: afterBuffer.toString('base64'),
  })
}

await waitForHttp(`http://127.0.0.1:${storePort}/health`)
await waitForHttp(`http://127.0.0.1:${cdpPort}/json/version`)
await seed()
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`)
try {
  const context = browser.contexts()[0]
  const page = context.pages()[0] ?? (await context.waitForEvent('page'))
  await page.waitForURL(/tauri\.localhost/, { timeout: 30_000 })
  await page.evaluate(() => {
    localStorage.setItem('flow:onboarded', '1')
    localStorage.setItem('flow:canvasGuideDismissed', '1')
  })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  const report = { ok: true, before: {}, after: {}, errors }
  for (const viewport of VIEWPORTS) {
    for (const theme of THEMES) {
      const key = `${viewport.name}-${theme}`
      const before = await capture(page, 'before', viewport, theme, false)
      const after = await capture(page, 'after', viewport, theme, true)
      report.before[key] = before.geometry
      report.after[key] = after.geometry
      report.before[key].pixelDiff = await compareScreenshots(
        page,
        before.screenshotBuffer,
        after.screenshotBuffer,
      )
    }
  }
  for (const key of Object.keys(report.before)) {
    const before = report.before[key]
    const after = report.after[key]
    const geometryKeys = ['x', 'y', 'width', 'height']
    report.ok = report.ok && before.nodes.length === after.nodes.length &&
      before.nodes.every((node, index) =>
        node.contentVisibility === 'visible' &&
        after.nodes[index].contentVisibility === 'auto' &&
        geometryKeys.every((field) => node[field] === after.nodes[index][field])) &&
      before.overflowX === after.overflowX &&
      before.nodeTextOverflow === after.nodeTextOverflow &&
      before.pixelDiff.sameSize &&
      before.pixelDiff.ratio <= 0.02 &&
      errors.length === 0
  }
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  if (!report.ok) process.exitCode = 1
} finally {
  await browser.close().catch(() => undefined)
}
