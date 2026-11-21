#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { deflateSync } from 'node:zlib'
import { chromium } from 'playwright'

export const PERFORMANCE_NODE_COUNT = 300
export const GENERATION_NODE_COUNT = 150
export const PERFORMANCE_EDGE_COUNT = 500
export const ASSET_SIZE = 1024
export const THUMB_SIZE = 64
export const MAX_P95_MS = 20
export const PERFORMANCE_PROJECT_ID = 'perf-release-300-500'
const VIEWPORT_PAN_EPSILON = 1
const VIEWPORT_ZOOM_EPSILON = 0.005

const ROOT = path.resolve(import.meta.dirname, '..')
const RESERVED_PORTS = new Set([1420, 18765, 18766, 18791])

/**
 * 64x64 WebP generated once by WebView2 canvas.toDataURL('image/webp', 0.86).
 * Keeping the bytes in source makes seeding deterministic and lets the pure
 * tests validate the exact thumbnail format without needing an image encoder.
 */
const THUMB_WEBP_BASE64 = [
  'UklGRkADAABXRUJQVlA4WAoAAAAgAAAAPwAAPwAASUNDUMgBAAAAAAHIAAAAAAQwAABtbnRyUkdC',
  'IFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAA',
  'AADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlk',
  'ZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAA',
  'ABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAA',
  'AAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAA',
  'AABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEA',
  'AAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAA',
  'ACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADZWUDggUgEAAPAOAJ0BKkAA',
  'QAA+PRaIQ7+hIRv/VgH4A8S0AFYcoKo/HL75/Hv2c/EnpSOXvCpN8cNwgst3iTD/5ha/KkUb',
  'o3+oEWqdDNTFwMFB5DEtjcggaYUCBas0i9YIqcTzSxx2BLU1x8bOOhz955tmAijHBvxzfUVu',
  'ws0v8TxGXsmz7LsAAPCSHezRi//0TNkC/poUqz2/7xmlXXZR2QsqKg7BFTeN8Jh/4on5Nl9Z',
  'uObTdhzsP8IKrGuDY8tpFC+O/qim0bu/J2GHQO6UP0eif1NPfO7vglYTmVRA4Gpv0SYXtErZ',
  'Cu00k7t7c85Pf/5T2SEP+rja9A2Nn19M/UKMxVyUonpCxKtyVIJiSJDT9jpkIHZxrzmZNgSC',
  'gtOFnAecgVZ9woIcV//we4TvNj72y56w1y+gZYNgHRrW61nQP72fECo5DK4OG44qT6RsBzl2',
  'ojgxwAAA',
].join('')

export const THUMB_WEBP_BYTES = Buffer.from(THUMB_WEBP_BASE64, 'base64')

let crcTable

export function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let index = 0; index < 256; index += 1) {
      let value = index
      for (let bit = 0; bit < 8; bit += 1) {
        value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
      }
      crcTable[index] = value >>> 0
    }
  }
  let value = 0xffffffff
  for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8)
  return (value ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, checksum])
}

/**
 * Builds a valid 1024x1024 RGB PNG. Each index gets a deterministic colour and
 * stripe pattern so all 150 generation nodes own distinct content-addressed
 * assets while the bytes stay small enough for a store write.
 */
export function createPatternPng(index, width = ASSET_SIZE, height = ASSET_SIZE) {
  const rowLength = width * 3
  const raw = Buffer.alloc((rowLength + 1) * height)
  const red = (41 + index * 37) % 256
  const green = (97 + index * 53) % 256
  const blue = (163 + index * 29) % 256
  const stripe = (index * 17) % width
  const row = Buffer.alloc(rowLength + 1)
  for (let x = 0; x < width; x += 1) {
    const offset = 1 + x * 3
    const inStripe = Math.abs(x - stripe) < 24
    row[offset] = inStripe ? (red + 80) % 256 : red
    row[offset + 1] = inStripe ? (green + 32) % 256 : green
    row[offset + 2] = inStripe ? (blue + 120) % 256 : blue
  }
  for (let y = 0; y < height; y += 1) {
    raw.set(row, y * (rowLength + 1))
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 6 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

export function binaryMarker(bytes) {
  return { __qhType: 'u8', base64: Buffer.from(bytes).toString('base64') }
}

export function bytesFromMarker(marker) {
  if (marker?.__qhType !== 'u8' || typeof marker.base64 !== 'string') {
    throw new Error('not a shared-store binary marker')
  }
  return Buffer.from(marker.base64, 'base64')
}

/**
 * Seeds a 300-node / 500-edge graph with 150 real generation assets. The asset
 * shape matches the V2 SQLite ingest contract and the V1 JSON contract:
 * id/hash are a 16-char SHA-1 prefix, bytes/thumb use the shared-store binary
 * marker, and the full SHA-1 is retained as contentSha1 for V2 verification.
 */
export function seedGraph() {
  const now = Date.now()
  const nodes = []
  const edges = []
  const assets = []
  const types = []
  const ids = []
  const columns = 20
  const thumbMarker = binaryMarker(THUMB_WEBP_BYTES)

  for (let generationIndex = 0; generationIndex < GENERATION_NODE_COUNT; generationIndex += 1) {
    const png = createPatternPng(generationIndex)
    const contentSha1 = createHash('sha1').update(png).digest('hex')
    const hash = contentSha1.slice(0, 16)
    const createdAt = now + generationIndex
    assets.push({
      id: hash,
      hash,
      projectId: PERFORMANCE_PROJECT_ID,
      mime: 'image/png',
      thumbMime: 'image/webp',
      width: ASSET_SIZE,
      height: ASSET_SIZE,
      bytesLength: png.length,
      thumbLength: THUMB_WEBP_BYTES.length,
      contentSha1,
      bytes: binaryMarker(png),
      thumb: thumbMarker,
      createdAt,
      updatedAt: createdAt,
    })
  }

  for (let index = 0; index < PERFORMANCE_NODE_COUNT; index += 1) {
    const type = index % 2 === 0 ? 'prompt' : 'generation'
    const generationIndex = type === 'generation' ? Math.floor(index / 2) : -1
    const asset = generationIndex >= 0 ? assets[generationIndex] : null
    const id = `perf-node-${String(index).padStart(3, '0')}`
    const column = index % columns
    const row = Math.floor(index / columns)
    types.push(type)
    ids.push(id)
    nodes.push({
      id,
      projectId: PERFORMANCE_PROJECT_ID,
      type,
      parentId: null,
      x: 40 + column * 240,
      y: 40 + row * 240,
      w: type === 'prompt' ? 240 : 192,
      h: type === 'prompt' ? 160 : 192,
      title: type === 'prompt' ? `性能提示词 ${index}` : `性能生成 ${index}`,
      disabled: false,
      data: asset
        ? {
            mode: 'image',
            prompt: '',
            linkedPromptNodeIds: [],
            channelId: '',
            model: '',
            assetHash: asset.id,
            assetMime: asset.mime,
            naturalSize: { width: asset.width, height: asset.height },
            thumbOrder: [asset.id],
            upstreamHidden: [],
          }
        : {
            text: `性能样本 ${index}`,
            upstreamPromptLinked: false,
            channelId: '',
            model: '',
          },
      updatedAt: now + index,
    })
  }

  const seen = new Set()
  outer: for (let span = 1; span <= 4; span += 1) {
    for (let index = 0; index < PERFORMANCE_NODE_COUNT; index += 1) {
      const targetIndex = (index + span) % PERFORMANCE_NODE_COUNT
      if (types[targetIndex] !== 'generation') continue
      if (index + span >= PERFORMANCE_NODE_COUNT) continue
      const source = ids[index]
      const target = ids[targetIndex]
      const key = `${source}>${target}`
      if (seen.has(key)) continue
      seen.add(key)
      edges.push({
        id: `perf-edge-${String(edges.length).padStart(3, '0')}`,
        projectId: PERFORMANCE_PROJECT_ID,
        source,
        target,
      })
      if (edges.length >= PERFORMANCE_EDGE_COUNT) break outer
    }
  }

  return { nodes, edges, assets }
}

function viewportNumbersChanged(before, after, mode) {
  if (
    !before ||
    !after ||
    !Number.isFinite(before.x) ||
    !Number.isFinite(before.y) ||
    !Number.isFinite(before.zoom) ||
    !Number.isFinite(after.x) ||
    !Number.isFinite(after.y) ||
    !Number.isFinite(after.zoom)
  ) {
    return false
  }
  if (mode === 'pan') {
    return Math.hypot(after.x - before.x, after.y - before.y) >= VIEWPORT_PAN_EPSILON
  }
  return Math.abs(after.zoom - before.zoom) >= VIEWPORT_ZOOM_EPSILON
}

function parseViewportLabel(label) {
  if (typeof label !== 'string') return null
  const match = label.match(/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)@(\d+(?:\.\d+)?)$/)
  if (!match) return null
  return {
    x: Number(match[1]),
    y: Number(match[2]),
    zoom: Number(match[3]),
  }
}

export function viewportRoundMovement(round, mode) {
  const dom = viewportNumbersChanged(round?.before?.domViewport, round?.after?.domViewport, mode)
  const store = viewportNumbersChanged(
    parseViewportLabel(round?.before?.storeViewport),
    parseViewportLabel(round?.after?.storeViewport),
    mode,
  )
  return { dom, store, pass: dom && store }
}

export function evaluatePerformanceGate(input) {
  const roundsPass = (rounds, mode) =>
    rounds.length === 3 &&
    rounds.every(
      (round) =>
        Number(round.p95Ms) <= MAX_P95_MS &&
        viewportRoundMovement(round, mode).pass,
    )
  const images = input.imageEvidence ?? {}
  return {
    mountedNodes: input.mountedNodes === PERFORMANCE_NODE_COUNT,
    mountedEdges: input.mountedEdges >= PERFORMANCE_EDGE_COUNT,
    renderedImages: images.renderedImages === GENERATION_NODE_COUNT,
    decodedImages: images.decodedImages === GENERATION_NODE_COUNT,
    thumbnailImages: images.thumbnailImages === GENERATION_NODE_COUNT,
    expectedThumbnailWidth:
      images.expectedWidthImages === GENERATION_NODE_COUNT,
    pageErrors: (input.pageErrors ?? []).length === 0,
    consoleErrors: (input.consoleErrors ?? []).length === 0,
    panP95: roundsPass(input.panRounds ?? [], 'pan'),
    zoomP95: roundsPass(input.zoomRounds ?? [], 'zoom'),
    uiMatrix: !input.uiMatrix || input.uiMatrix.pass,
    panMovement:
      input.panRounds?.length === 3 &&
      input.panRounds.every((round) => viewportRoundMovement(round, 'pan').pass),
    zoomMovement:
      input.zoomRounds?.length === 3 &&
      input.zoomRounds.every((round) => viewportRoundMovement(round, 'zoom').pass),
  }
}

/**
 * Creates the report from measured facts only. The renderedImages and
 * decodedImages assertions are first-class fields so a count shortfall produces
 * ok:false instead of a green benchmark with blank nodes.
 */
export function buildPerformanceReport(input) {
  const mountedNodes = input.mountedNodes ?? input.graph?.mountedNodes
  const mountedEdges = input.mountedEdges ?? input.graph?.mountedEdges
  const assertionChecks = evaluatePerformanceGate({
    ...input,
    mountedNodes,
    mountedEdges,
  })
  const assertions = {
    mountedNodes: {
      expected: PERFORMANCE_NODE_COUNT,
      actual: mountedNodes,
      pass: assertionChecks.mountedNodes,
    },
    mountedEdges: {
      minimum: PERFORMANCE_EDGE_COUNT,
      actual: mountedEdges,
      pass: assertionChecks.mountedEdges,
    },
    renderedImages: {
      expected: GENERATION_NODE_COUNT,
      actual: input.imageEvidence?.renderedImages ?? 0,
      pass: assertionChecks.renderedImages,
    },
    decodedImages: {
      expected: GENERATION_NODE_COUNT,
      actual: input.imageEvidence?.decodedImages ?? 0,
      pass: assertionChecks.decodedImages,
    },
    thumbnailImages: {
      expected: GENERATION_NODE_COUNT,
      actual: input.imageEvidence?.thumbnailImages ?? 0,
      pass: assertionChecks.thumbnailImages,
    },
    expectedThumbnailWidth: {
      expected: THUMB_SIZE,
      actual: input.imageEvidence?.expectedWidthImages ?? 0,
      pass: assertionChecks.expectedThumbnailWidth,
    },
    pageErrors: {
      expected: 0,
      actual: input.pageErrors.length,
      pass: assertionChecks.pageErrors,
    },
    consoleErrors: {
      expected: 0,
      actual: input.consoleErrors.length,
      pass: assertionChecks.consoleErrors,
    },
    panP95: {
      maximumMs: MAX_P95_MS,
      actualMs: input.panRounds.map((round) => round.p95Ms),
      pass: assertionChecks.panP95,
    },
    panMovement: {
      rounds: input.panRounds.map((round) => viewportRoundMovement(round, 'pan')),
      pass: assertionChecks.panMovement,
    },
    zoomP95: {
      maximumMs: MAX_P95_MS,
      actualMs: input.zoomRounds.map((round) => round.p95Ms),
      pass: assertionChecks.zoomP95,
    },
    zoomMovement: {
      rounds: input.zoomRounds.map((round) => viewportRoundMovement(round, 'zoom')),
      pass: assertionChecks.zoomMovement,
    },
    ...(input.uiMatrix
      ? {
          uiMatrix: {
            rounds: input.uiMatrix.rounds.length,
            pass: assertionChecks.uiMatrix,
          },
        }
      : {}),
  }
  return {
    ok: Object.values(assertionChecks).every(Boolean),
    environment: input.environment,
    graph: input.graph,
    assets: input.assets,
    images: input.imageEvidence,
    panRounds: input.panRounds,
    zoomRounds: input.zoomRounds,
    pageErrors: input.pageErrors,
    consoleErrors: input.consoleErrors,
    assertions,
    evidence: input.evidence,
  }
}

function percentile(values, ratio) {
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)
  return sorted[Math.max(0, index)]
}

export function summarizeFrames(intervals) {
  const frames = intervals.length
  return {
    averageMs:
      intervals.reduce((total, value) => total + value, 0) / Math.max(1, frames),
    p50Ms: percentile(intervals, 0.5),
    p95Ms: percentile(intervals, 0.95),
    p99Ms: percentile(intervals, 0.99),
    maxMs: intervals.length > 0 ? Math.max(...intervals) : 0,
    over20Frames: intervals.filter((value) => value > MAX_P95_MS).length,
    over33Frames: intervals.filter((value) => value > 33).length,
    frames,
  }
}

function performanceMetricsDelta(before, after) {
  if (!before || !after) return null
  const names = [
    'TaskDuration',
    'ScriptDuration',
    'LayoutDuration',
    'RecalcStyleDuration',
    'V8CompileDuration',
  ]
  return {
    ...Object.fromEntries(
      names.map((name) => [
        name,
        Math.max(0, Number(after[name] ?? 0) - Number(before[name] ?? 0)),
      ]),
    ),
    jsHeapUsedBytesAfter: Number(after.JSHeapUsedSize ?? 0),
    nodesAfter: Number(after.Nodes ?? 0),
    layoutObjectsAfter: Number(after.LayoutObjects ?? 0),
  }
}

async function readPerformanceMetrics(session) {
  if (!session) return null
  try {
    const { metrics } = await session.send('Performance.getMetrics')
    return Object.fromEntries(metrics.map((metric) => [metric.name, metric.value]))
  } catch {
    return null
  }
}

async function beginPerformanceTrace(session) {
  if (!session) return null
  const chunks = []
  const onData = (event) => chunks.push(...event.value)
  session.on('Tracing.dataCollected', onData)
  const complete = new Promise((resolve) => {
    session.once('Tracing.tracingComplete', resolve)
  })
  try {
    await session.send('Tracing.start', {
      categories: [
        'devtools.timeline',
        'blink.user_timing',
        'disabled-by-default-devtools.timeline.frame',
      ].join(','),
    })
  } catch {
    session.off('Tracing.dataCollected', onData)
    return null
  }
  return async () => {
    try {
      await session.send('Tracing.end')
      await complete
    } finally {
      session.off('Tracing.dataCollected', onData)
    }
    return chunks
  }
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

async function blankPointerPoint(page, surface) {
  const point = await page.evaluate((bounds) => {
    const targetX = bounds.x + bounds.width * 0.55
    const targetY = bounds.y + bounds.height * 0.55
    let best = null
    let bestDistance = Number.POSITIVE_INFINITY
    for (let row = 0; row <= 24; row += 1) {
      for (let column = 0; column <= 32; column += 1) {
        const x = bounds.x + bounds.width * ((column + 0.5) / 33)
        const y = bounds.y + bounds.height * ((row + 0.5) / 25)
        const target = document.elementFromPoint(x, y)
        if (!target?.closest('.react-flow__pane')) continue
        if (
          target.closest(
            '[data-node-id], [data-flow-hud], [data-canvas-zoom], [data-canvas-minimap], .react-flow__controls',
          )
        ) {
          continue
        }
        const distance = Math.hypot(x - targetX, y - targetY)
        if (distance < bestDistance) {
          best = { x, y }
          bestDistance = distance
        }
      }
    }
    return best
  }, surface)
  if (!point) throw new Error('canvas has no unobstructed React Flow pane point')
  return point
}

async function panRound(page) {
  const surface = await page.locator('[data-canvas-surface]').boundingBox()
  if (!surface) throw new Error('canvas surface has no bounding box')
  const { x, y } = await blankPointerPoint(page, surface)
  await page.mouse.move(x, y)
  await page.mouse.down({ button: 'middle' })
  const intervals = await sampleFrames(page, async () => {
    for (let index = 0; index < 24; index += 1) {
      const direction = index % 2 === 0 ? 1 : -1
      await page.mouse.move(x + direction * 260, y + direction * 90, { steps: 4 })
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  })
  await page.mouse.up({ button: 'middle' })
  return intervals
}

async function zoomRound(page) {
  const surface = await page.locator('[data-canvas-surface]').boundingBox()
  if (!surface) throw new Error('canvas surface has no bounding box')
  const { x, y } = await blankPointerPoint(page, surface)
  await page.mouse.move(x, y)
  return sampleFrames(page, async () => {
    for (let index = 0; index < 24; index += 1) {
      // A small net zoom-in per round keeps every measured round below maxZoom
      // while still exercising both wheel directions.
      await page.mouse.wheel(0, index % 2 === 0 ? -140 : 120)
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  })
}

async function settleZoomAt(page, targetZoom = 0.8) {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const state = await viewportState(page)
    const zoom = state.domViewport?.zoom
    if (!Number.isFinite(zoom)) break
    if (Math.abs(zoom - targetZoom) < 0.03) return
    const surface = await page.locator('[data-canvas-surface]').boundingBox()
    if (!surface) throw new Error('canvas surface has no bounding box')
    const { x, y } = await blankPointerPoint(page, surface)
    await page.mouse.move(x, y)
    await page.mouse.wheel(0, zoom < targetZoom ? -160 : 160)
    await page.waitForTimeout(60)
  }
}

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

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`${url} failed: ${await response.text()}`)
  return response.json()
}

async function put(storePort, table, row) {
  await postJson(`http://127.0.0.1:${storePort}/put`, { table, row })
}

async function bulkPut(storePort, table, rows) {
  await postJson(`http://127.0.0.1:${storePort}/bulkPut`, { table, rows })
}

async function queryRows(storePort, table, filter) {
  const result = await postJson(`http://127.0.0.1:${storePort}/query`, {
    table,
    filter,
    includePayload: false,
  })
  return result.rows
}

function portIsListening(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port })
    const finish = (value) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(value)
    }
    socket.setTimeout(500)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

async function assertProbePortsFree(ports) {
  for (const port of ports) {
    if (!Number.isInteger(port) || port <= 0 || RESERVED_PORTS.has(port)) {
      throw new Error(`refusing unsafe performance probe port: ${port}`)
    }
    if (await portIsListening(port)) {
      throw new Error(`performance probe port ${port} is already in use; not touching it`)
    }
  }
}

async function collectImageEvidence(page) {
  return page.evaluate((expectedThumbWidth) => {
    const generationNodes = Array.from(
      document.querySelectorAll('[data-node-type="generation"]'),
    )
    const images = Array.from(
      document.querySelectorAll('[data-node-type="generation"] img'),
    )
    const samples = images.slice(0, 5).map((image) => ({
      nodeId: image.closest('[data-node-id]')?.getAttribute('data-node-id') ?? null,
      src: image.currentSrc || image.src,
      complete: image.complete,
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
    }))
    const decoded = images.filter((image) => image.complete && image.naturalWidth > 0)
    const thumbnails = images.filter((image) =>
      (image.currentSrc || image.src).includes('/thumb/'),
    )
    return {
      selector: '[data-node-type="generation"] img',
      generationNodes: generationNodes.length,
      renderedImages: images.length,
      decodedImages: decoded.length,
      thumbnailImages: thumbnails.length,
      expectedThumbnailWidth: expectedThumbWidth,
      expectedWidthImages: decoded.filter(
        (image) => image.naturalWidth === expectedThumbWidth,
      ).length,
      uniqueThumbnailSrcs: new Set(thumbnails.map((image) => image.currentSrc || image.src))
        .size,
      widths: decoded.reduce((counts, image) => {
        const key = String(image.naturalWidth)
        counts[key] = (counts[key] ?? 0) + 1
        return counts
      }, {}),
      samples,
    }
  }, THUMB_SIZE)
}

async function waitForImageEvidence(page, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs
  let evidence = await collectImageEvidence(page)
  while (
    Date.now() < deadline &&
    (evidence.renderedImages < GENERATION_NODE_COUNT ||
      evidence.decodedImages < GENERATION_NODE_COUNT ||
      evidence.thumbnailImages < GENERATION_NODE_COUNT ||
      evidence.expectedWidthImages < GENERATION_NODE_COUNT)
  ) {
    await new Promise((resolve) => setTimeout(resolve, 250))
    evidence = await collectImageEvidence(page)
  }
  return evidence
}

async function compareScreenshots(page, before, after) {
  return page.evaluate(async ({ beforeBase64, afterBase64 }) => {
    const load = async (base64) => {
      const blob = await fetch(`data:image/png;base64,${base64}`).then((response) =>
        response.blob(),
      )
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
    const [left, right] = await Promise.all([
      load(beforeBase64),
      load(afterBase64),
    ])
    if (left.width !== right.width || left.height !== right.height) {
      return { sameSize: false, diffPixels: -1, ratio: 1, over20: -1 }
    }
    let diffPixels = 0
    let over20 = 0
    for (let offset = 0; offset < left.pixels.length; offset += 4) {
      const delta = Math.max(
        Math.abs(left.pixels[offset] - right.pixels[offset]),
        Math.abs(left.pixels[offset + 1] - right.pixels[offset + 1]),
        Math.abs(left.pixels[offset + 2] - right.pixels[offset + 2]),
      )
      if (delta === 0) continue
      diffPixels += 1
      if (delta > 20) over20 += 1
    }
    return {
      sameSize: true,
      diffPixels,
      ratio: diffPixels / (left.width * left.height),
      over20,
    }
  }, {
    beforeBase64: before.toString('base64'),
    afterBase64: after.toString('base64'),
  })
}

async function captureCullingUiMatrix(page, runRoot) {
  const output = path.join(runRoot, 'ui-matrix')
  fs.mkdirSync(output, { recursive: true })
  const combinations = [
    { width: 1440, height: 900, theme: 'light' },
    { width: 1440, height: 900, theme: 'dark' },
    { width: 1024, height: 700, theme: 'light' },
    { width: 1024, height: 700, theme: 'dark' },
  ]
  const rounds = []
  for (const combination of combinations) {
    const name = `${combination.width}x${combination.height}-${combination.theme}`
    await page.setViewportSize({
      width: combination.width,
      height: combination.height,
    })
    await page.evaluate((theme) => localStorage.setItem('flow:theme', theme), combination.theme)
    await page.goto(`http://tauri.localhost/canvas/${PERFORMANCE_PROJECT_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    })
    await page.locator('[data-canvas-hydrated="true"]').waitFor({ timeout: 60_000 })
    await page.waitForFunction(
      (expected) => document.querySelectorAll('.react-flow__node').length === expected,
      PERFORMANCE_NODE_COUNT,
      { timeout: 60_000 },
    )
    await page.waitForFunction(
      (expected) =>
        document.querySelectorAll('.react-flow__node[data-node-viewport-culled]').length ===
        expected,
      PERFORMANCE_NODE_COUNT,
      { timeout: 10_000 },
    )
    const images = await waitForImageEvidence(page, 60_000)
    await page.waitForTimeout(250)
    const afterBuffer = await page.screenshot()
    const afterPath = path.join(output, `after-${name}.png`)
    fs.writeFileSync(afterPath, afterBuffer)
    const afterGeometry = await page.evaluate(() => ({
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      culled: document.querySelectorAll(
        '.react-flow__node[data-node-viewport-culled="hidden"]',
      ).length,
      visibleLeaves: document.querySelectorAll(
        '.react-flow__node[data-node-viewport-culled="visible"]',
      ).length,
      nodes: [...document.querySelectorAll('.react-flow__node')].map((node) => {
        const rect = node.getBoundingClientRect()
        return {
          id: node.getAttribute('data-id'),
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          contentVisibility: getComputedStyle(node).contentVisibility,
        }
      }),
    }))
    const baselineStyle = await page.addStyleTag({
      content:
        '.react-flow__node[data-node-viewport-culled] { content-visibility: auto !important; contain-intrinsic-size: auto 240px 160px !important; }',
    })
    await page.waitForTimeout(250)
    const beforeBuffer = await page.screenshot()
    const beforePath = path.join(output, `before-${name}.png`)
    fs.writeFileSync(beforePath, beforeBuffer)
    const beforeGeometry = await page.evaluate(() => ({
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      nodes: [...document.querySelectorAll('.react-flow__node')].map((node) => {
        const rect = node.getBoundingClientRect()
        return {
          id: node.getAttribute('data-id'),
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          contentVisibility: getComputedStyle(node).contentVisibility,
        }
      }),
    }))
    await baselineStyle.evaluate((element) => element.remove())
    const pixelDiff = await compareScreenshots(page, beforeBuffer, afterBuffer)
    const geometryStable =
      afterGeometry.nodes.length === PERFORMANCE_NODE_COUNT &&
      beforeGeometry.nodes.length === PERFORMANCE_NODE_COUNT &&
      afterGeometry.nodes.every((node, index) => {
        const other = beforeGeometry.nodes[index]
        return (
          node.id === other.id &&
          Math.abs(node.x - other.x) < 0.01 &&
          Math.abs(node.y - other.y) < 0.01 &&
          Math.abs(node.width - other.width) < 0.01 &&
          Math.abs(node.height - other.height) < 0.01
        )
      })
    rounds.push({
      viewport: combination,
      images,
      culling: {
        culled: afterGeometry.culled,
        visibleLeaves: afterGeometry.visibleLeaves,
        total: afterGeometry.culled + afterGeometry.visibleLeaves,
      },
      geometryStable,
      overflowX: afterGeometry.overflowX || beforeGeometry.overflowX,
      pixelDiff,
      screenshots: {
        before: path.relative(ROOT, beforePath),
        after: path.relative(ROOT, afterPath),
      },
      pass:
        images.renderedImages === GENERATION_NODE_COUNT &&
        images.decodedImages === GENERATION_NODE_COUNT &&
        images.thumbnailImages === GENERATION_NODE_COUNT &&
        afterGeometry.culled > 0 &&
        afterGeometry.visibleLeaves > 0 &&
        geometryStable &&
        !afterGeometry.overflowX &&
        !beforeGeometry.overflowX &&
        pixelDiff.sameSize &&
        pixelDiff.ratio <= 0.02,
    })
  }
  return {
    pass: rounds.every((round) => round.pass),
    rounds,
  }
}

async function viewportState(page) {
  return page.evaluate(() => {
    const viewport = document.querySelector('.react-flow__viewport')
    const transform = viewport ? getComputedStyle(viewport).transform : null
    let domViewport = null
    if (transform && transform !== 'none') {
      try {
        const matrix = new DOMMatrixReadOnly(transform)
        domViewport = {
          x: matrix.m41,
          y: matrix.m42,
          zoom: Math.hypot(matrix.m11, matrix.m12),
        }
      } catch {
        domViewport = null
      }
    }
    return {
      coarseNodes: document.querySelectorAll('[data-coarse-node]').length,
      fullNodes: document.querySelectorAll('[data-node-type]:not([data-coarse-node])').length,
      culledNodes: document.querySelectorAll(
        '.react-flow__node[data-node-viewport-culled="hidden"]',
      ).length,
      cullingVisibleNodes: document.querySelectorAll(
        '.react-flow__node[data-node-viewport-culled="visible"]',
      ).length,
      rfViewport:
        document.querySelector('[data-flow-rf-vp]')?.getAttribute('data-flow-rf-vp') ?? null,
      storeViewport:
        document.querySelector('[data-flow-store-vp]')?.getAttribute('data-flow-store-vp') ?? null,
      domTransform: transform,
      domViewport,
    }
  })
}

async function main() {
  if (process.platform !== 'win32') {
    console.log(
      'canvas release performance gate skipped: Windows WebView2 release shell is required',
    )
    return
  }

  const dist = path.join(ROOT, 'dist', 'index.html')
  const releaseExe = process.env.QH_PERF_RELEASE_EXE
    ? path.resolve(process.env.QH_PERF_RELEASE_EXE)
    : path.join(ROOT, 'src-tauri', 'target', 'release', 'qinghua.exe')
  const storePort = Number(process.env.QH_PERF_STORE_PORT ?? 18772)
  const cdpPort = Number(process.env.QH_PERF_CDP_PORT ?? 9445)
  const diagnosticCss = process.env.QH_PERF_DIAGNOSTIC_CSS ?? null
  const configuredRounds = Number(process.env.QH_PERF_DIAGNOSTIC_ROUNDS ?? '')
  const measurementRounds =
    diagnosticCss && Number.isInteger(configuredRounds) && configuredRounds > 0
      ? Math.min(configuredRounds, 3)
      : 3
  const runRoot = path.join(
    ROOT,
    '.playwright-verify',
    `canvas-perf-release-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 23)}`,
  )
  const dataDir = path.join(runRoot, 'product', 'data-v2')
  const localAppData = path.join(runRoot, 'localappdata')
  const reportPath = path.join(runRoot, 'report.json')
  const markdownPath = path.join(runRoot, 'REPORT.md')
  const screenshotPath = path.join(runRoot, 'canvas.png')
  const tracePath = path.join(runRoot, 'pan.trace.json')

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
  await assertProbePortsFree([storePort, cdpPort])
  fs.mkdirSync(dataDir, { recursive: true })
  fs.mkdirSync(localAppData, { recursive: true })

  const seeded = seedGraph()
  const appLogPath = path.join(runRoot, 'app.log')
  const appLog = fs.openSync(appLogPath, 'w')
  let app
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
    const health = JSON.parse(
      await waitForHttp(
        `http://127.0.0.1:${storePort}/health`,
        30_000,
        (body) => JSON.parse(body).service === 'qinghua-shared-store',
      ),
    )

    await put(storePort, 'projects', {
      id: PERFORMANCE_PROJECT_ID,
      workbench: 'canvas',
      name: 'Release 性能门禁 300/500 + 150 真实图',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      thumbnail: null,
      extra: {},
    })
    if (process.env.KNIFE_PHOTO_BENCH) {
      await waitForHttp(`http://127.0.0.1:${cdpPort}/json/version`, 30_000)
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`)
      const ctx = browser.contexts()[0]
      const page = ctx.pages()[0] ?? await ctx.waitForEvent('page')
      await page.waitForURL(/tauri\.localhost/)
      await page.evaluate(theme => {
        localStorage.setItem('flow:onboarded', '1')
        localStorage.setItem('flow:canvasGuideDismissed', '1')
        localStorage.setItem('flow:theme', theme)
      },process.env.KNIFE_THEME??'light')
      await page.goto(`http://tauri.localhost/canvas/${PERFORMANCE_PROJECT_ID}`)
      const {knifePhotoBench} = await import('./knifePhotoBench.mjs')
      await knifePhotoBench(page, PERFORMANCE_PROJECT_ID, process.env.KNIFE_PHOTO_BENCH,
        (table,row) => put(storePort,table,row))
      return
    }
    await bulkPut(storePort, 'assets', seeded.assets)
    await bulkPut(storePort, 'nodes', seeded.nodes)
    await bulkPut(storePort, 'edges', seeded.edges)

    const storedAssets = await queryRows(storePort, 'assets', {
      projectId: PERFORMANCE_PROJECT_ID,
    })
    const storedAssetEvidence = {
      rows: storedAssets.length,
      withBytesLength: storedAssets.filter((row) => Number(row.bytesLength) > 0).length,
      withThumbLength: storedAssets.filter((row) => Number(row.thumbLength) > 0).length,
      bytesLength: storedAssets.reduce(
        (total, row) => total + Number(row.bytesLength ?? 0),
        0,
      ),
      thumbLength: storedAssets.reduce(
        (total, row) => total + Number(row.thumbLength ?? 0),
        0,
      ),
      thumbnailMime: 'image/webp',
      sourceMime: 'image/png',
    }
    const generationNodes = seeded.nodes.filter((node) => node.type === 'generation')
    const assetEvidence = {
      expectedRows: GENERATION_NODE_COUNT,
      generationNodes: generationNodes.length,
      generationNodesWithAssetHash: generationNodes.filter((node) =>
        Boolean(node.data.assetHash),
      ).length,
      uniqueAssetHashes: new Set(generationNodes.map((node) => node.data.assetHash)).size,
      source: 'node zlib deflate + CRC32',
      sourceWidth: ASSET_SIZE,
      sourceHeight: ASSET_SIZE,
      thumbnailWidth: THUMB_SIZE,
      thumbnailHeight: THUMB_SIZE,
      thumbnailFormat: 'image/webp',
      thumbnailBytes: THUMB_WEBP_BYTES.length,
      stored: storedAssetEvidence,
    }

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
    const consoleErrors = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    await page.goto(`http://tauri.localhost/canvas/${PERFORMANCE_PROJECT_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    })
    let cdp = null
    try {
      cdp = await context.newCDPSession(page)
      await cdp.send('Performance.enable')
    } catch {
      cdp = null
    }
    await page.locator('[data-canvas-hydrated="true"]').waitFor({ timeout: 60_000 })
    await page.waitForFunction(
      (expected) => document.querySelectorAll('[data-node-id]').length >= expected,
      PERFORMANCE_NODE_COUNT,
      { timeout: 60_000 },
    )
    const imageEvidence = await waitForImageEvidence(page)
    if (diagnosticCss) await page.addStyleTag({ content: diagnosticCss })
    await page.waitForTimeout(1000)
    const mountedNodes = await page.locator('[data-node-id]').count()
    const mountedEdges = await page.locator('.react-flow__edge').count()
    const viewport = await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
    }))

    // Hydration and first-use setup are not part of steady-state frame measurements.
    await panRound(page)
    await zoomRound(page)
    await page.waitForTimeout(500)

    const panRounds = []
    const zoomRounds = []
    let performanceTrace = null
    for (let round = 0; round < measurementRounds; round += 1) {
      const before = await viewportState(page)
      const performanceBefore = await readPerformanceMetrics(cdp)
      const stopTrace =
        round === 0 && process.env.QH_PERF_TRACE === '1'
          ? await beginPerformanceTrace(cdp)
          : null
      const intervals = await panRound(page)
      const after = await viewportState(page)
      const performanceAfter = await readPerformanceMetrics(cdp)
      if (stopTrace) {
        const events = await stopTrace()
        fs.writeFileSync(tracePath, JSON.stringify({ traceEvents: events }))
        performanceTrace = path.relative(ROOT, tracePath)
      }
      panRounds.push({
        ...summarizeFrames(intervals),
        frameIntervalsMs: intervals,
        before,
        after,
        performanceMetrics: performanceMetricsDelta(performanceBefore, performanceAfter),
      })
      await page.waitForTimeout(250)
    }

    // Pan leaves the viewport at a different origin. Precondition the zoom path
    // separately so round one measures steady-state zoom, not the phase switch.
    await settleZoomAt(page)
    await zoomRound(page)
    await page.waitForTimeout(250)
    for (let round = 0; round < measurementRounds; round += 1) {
      await settleZoomAt(page)
      const before = await viewportState(page)
      const performanceBefore = await readPerformanceMetrics(cdp)
      const intervals = await zoomRound(page)
      const after = await viewportState(page)
      const performanceAfter = await readPerformanceMetrics(cdp)
      zoomRounds.push({
        ...summarizeFrames(intervals),
        frameIntervalsMs: intervals,
        before,
        after,
        performanceMetrics: performanceMetricsDelta(performanceBefore, performanceAfter),
      })
      await page.waitForTimeout(250)
    }

    let screenshot = null
    try {
      await page.locator('[data-canvas-surface]').screenshot({ path: screenshotPath })
      screenshot = path.relative(ROOT, screenshotPath)
    } catch (error) {
      screenshot = `screenshot failed: ${String(error)}`
    }
    const uiMatrix =
      process.env.QH_PERF_UI_MATRIX === '1'
        ? await captureCullingUiMatrix(page, runRoot)
        : null

    const report = buildPerformanceReport({
      environment: {
        built: 'Tauri release + WebView2',
        viewport,
        browser: 'installed WebView2',
        store: `${health.backend ?? 'unknown'} on port ${storePort}`,
        storeDataDir: health.dataDir ?? dataDir,
        releaseExe,
        diagnosticCss,
        measurementRounds,
      },
      graph: {
        nodes: seeded.nodes.length,
        edges: seeded.edges.length,
        mountedNodes,
        mountedEdges,
      },
      assets: assetEvidence,
      imageEvidence,
      panRounds,
      zoomRounds,
      pageErrors,
      consoleErrors,
      uiMatrix,
      evidence: {
        canvasScreenshot: screenshot,
        appLog: path.relative(ROOT, appLogPath),
        performanceTrace,
        uiMatrix,
      },
    })
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
    fs.writeFileSync(
      markdownPath,
      [
        '# Canvas release performance gate',
        '',
        `Status: **${report.ok ? 'PASS' : 'FAIL'}**`,
        '',
        `- graph: ${seeded.nodes.length} nodes / ${seeded.edges.length} edges; mounted ${mountedNodes} nodes / ${mountedEdges} edges`,
        `- assets: ${assetEvidence.expectedRows} PNG rows; stored ${storedAssetEvidence.rows}; thumbLength rows ${storedAssetEvidence.withThumbLength}`,
        `- images: rendered ${imageEvidence.renderedImages} / decoded ${imageEvidence.decodedImages} / thumb ${imageEvidence.thumbnailImages}; expected width ${imageEvidence.expectedThumbnailWidth}px`,
        `- environment: ${report.environment.built}, ${viewport.width}x${viewport.height}, ${report.environment.store}`,
        `- pan P95: ${panRounds.map((round) => round.p95Ms.toFixed(2) + 'ms').join(' / ')}`,
        `- pan movement: ${report.assertions.panMovement.rounds.map((round) => round.pass ? 'PASS' : 'FAIL').join(' / ')}`,
        `- zoom P95: ${zoomRounds.map((round) => round.p95Ms.toFixed(2) + 'ms').join(' / ')}`,
        `- zoom movement: ${report.assertions.zoomMovement.rounds.map((round) => round.pass ? 'PASS' : 'FAIL').join(' / ')}`,
        `- pan worst frame: ${panRounds.map((round) => round.maxMs.toFixed(2) + 'ms').join(' / ')}`,
        `- zoom worst frame: ${zoomRounds.map((round) => round.maxMs.toFixed(2) + 'ms').join(' / ')}`,
        `- pan main-thread task: ${panRounds.map((round) => `${((round.performanceMetrics?.TaskDuration ?? 0) * 1000).toFixed(1)}ms`).join(' / ')}`,
        `- zoom main-thread task: ${zoomRounds.map((round) => `${((round.performanceMetrics?.TaskDuration ?? 0) * 1000).toFixed(1)}ms`).join(' / ')}`,
        `- culling UI matrix: ${uiMatrix ? (uiMatrix.pass ? 'PASS' : 'FAIL') : 'not requested'}`,
        `- errors: page ${pageErrors.length} / console ${consoleErrors.length}`,
        `- screenshot: ${screenshot}`,
        '',
      ].join('\n'),
    )
    console.log(JSON.stringify(report, null, 2))
    console.log(`evidence: ${path.relative(ROOT, reportPath)}`)
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
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? '')).href) {
  await main()
}
