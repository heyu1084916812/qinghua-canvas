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
const STRESS_MODE = process.env.QH_PERF_STRESS === '1'
const SAMPLE_DURATION_MS = STRESS_MODE ? 8000 : 1200

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

export function nodeDragRoundMovement(round) {
  const movedPx = Number(round?.movement?.movedPx)
  const finalDeltaPx = Number(round?.movement?.finalDeltaPx)
  return {
    movedPx,
    finalDeltaPx,
    pass:
      Number.isFinite(movedPx) &&
      movedPx >= 80 &&
      Number.isFinite(finalDeltaPx) &&
      finalDeltaPx <= 2,
  }
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
    panFastPath:
      input.panRounds?.length === 3 &&
      input.panRounds.every((round) => {
        const gesture = round.gesture
        return (
          gesture?.moving === true &&
          gesture.edgeDisplay === 'none' &&
          gesture.backgroundDisplay === 'none' &&
          gesture.fastLayer === true &&
          Number(gesture.fastPaths) > 0 &&
          Boolean(gesture.fastBackground) &&
          Number(gesture.coarseNodes) === 0 &&
          Number(gesture.visibleImages) > 0 &&
          Number(gesture.mountedNodes) === PERFORMANCE_NODE_COUNT &&
          Number(gesture.cullingVisibleNodes) < Number(gesture.mountedNodes) &&
          Number(gesture.restoredNodes) === PERFORMANCE_NODE_COUNT
        )
      }),
    lowZoomPanP95:
      input.lowZoomPanRounds?.length === 3 &&
      input.lowZoomPanRounds.every(
        (round) => Number(round.p95Ms) <= MAX_P95_MS,
      ),
    lowZoomPanFirstFrame:
      input.lowZoomPanRounds?.length === 3 &&
      input.lowZoomPanRounds.every(
        (round) =>
          Math.abs(Number(round.firstFrameDelta?.x) - round.expectedFirstDelta.x) <= 1 &&
          Math.abs(Number(round.firstFrameDelta?.y) - round.expectedFirstDelta.y) <= 1,
      ),
    lowZoomPanAppearance:
      input.lowZoomPanRounds?.length === 3 &&
      input.lowZoomPanRounds.every((round) => {
        const gesture = round.gesture
        return (
          gesture?.moving === true &&
          gesture.mode === 'pan' &&
          Number(gesture.coarseNodes) === 0 &&
          Number(gesture.hiddenImages) === 0 &&
          Number(gesture.visibleImages) >= GENERATION_NODE_COUNT * 0.9 &&
          gesture.promptCanvasVisible === true &&
          Number(gesture.hiddenPromptBodies) > 0 &&
          Number(gesture.mountedNodes) === PERFORMANCE_NODE_COUNT &&
          Number(gesture.restoredNodes) === PERFORMANCE_NODE_COUNT
        )
      }),
    zoomMovement:
      input.zoomRounds?.length === 3 &&
      input.zoomRounds.every((round) => viewportRoundMovement(round, 'zoom').pass),
    zoomFastPath:
      input.zoomRounds?.length === 3 &&
      input.zoomRounds.every((round) => {
        const gesture = round.gesture
        return (
          gesture?.moving === true &&
          Boolean(gesture.background) &&
          gesture.edgeDisplay === 'none' &&
          (gesture.fastLayer === true ||
            (Number(gesture.coarseNodes) > 0 &&
              Number(gesture.coarseNodes) === Number(gesture.mountedNodes))) &&
          Number(gesture.restoredNodes) === PERFORMANCE_NODE_COUNT
        )
      }),
    dragP95:
      input.dragRounds?.length === 3 &&
      input.dragRounds.every(
        (round) =>
          Number(round.p95Ms) <= MAX_P95_MS &&
          nodeDragRoundMovement(round).pass,
      ),
    dragMovement:
      input.dragRounds?.length === 3 &&
      input.dragRounds.every((round) => nodeDragRoundMovement(round).pass),
    dragPreservesAppearance:
      input.dragRounds?.length === 3 &&
      input.dragRounds.every(
        (round) =>
          Number(round.dragObserverLog?.layersDuringDrag?.coarseNodes ?? 0) === 0 &&
          Number(round.dragObserverLog?.layersDuringDrag?.hiddenImageNodes ?? 0) === 0,
      ),
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
    panFastPath: {
      rounds: input.panRounds.map((round) => round.gesture ?? null),
      pass: assertionChecks.panFastPath,
    },
    lowZoomPanP95: {
      maximumMs: MAX_P95_MS,
      actualMs: input.lowZoomPanRounds.map((round) => round.p95Ms),
      pass: assertionChecks.lowZoomPanP95,
    },
    lowZoomPanFirstFrame: {
      expectedDelta: input.lowZoomPanRounds[0]?.expectedFirstDelta ?? null,
      actualDeltas: input.lowZoomPanRounds.map((round) => round.firstFrameDelta),
      pass: assertionChecks.lowZoomPanFirstFrame,
    },
    lowZoomPanAppearance: {
      rounds: input.lowZoomPanRounds.map((round) => round.gesture ?? null),
      pass: assertionChecks.lowZoomPanAppearance,
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
    zoomFastPath: {
      rounds: input.zoomRounds.map((round) => round.gesture ?? null),
      pass: assertionChecks.zoomFastPath,
    },
    dragP95: {
      maximumMs: MAX_P95_MS,
      actualMs: input.dragRounds.map((round) => round.p95Ms),
      pass: assertionChecks.dragP95,
    },
    dragMovement: {
      rounds: input.dragRounds.map((round) => nodeDragRoundMovement(round)),
      pass: assertionChecks.dragMovement,
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
    lowZoomPanRounds: input.lowZoomPanRounds,
    zoomRounds: input.zoomRounds,
    dragRounds: input.dragRounds,
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

async function sampleFrames(page, action, durationMs = SAMPLE_DURATION_MS) {
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
    const portHitRects = [...document.querySelectorAll('[data-flow-port-hit]')].map(
      (element) => element.getBoundingClientRect(),
    )
    let best = null
    let fallback = null
    let bestDistance = Number.POSITIVE_INFINITY
    let fallbackDistance = Number.POSITIVE_INFINITY
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
        if (distance < fallbackDistance) {
          fallback = { x, y }
          fallbackDistance = distance
        }
        if (
          portHitRects.some(
            (rect) =>
              x >= rect.left - 4 &&
              x <= rect.right + 4 &&
              y >= rect.top - 4 &&
              y <= rect.bottom + 4,
          )
        ) {
          continue
        }
        if (distance < bestDistance) {
          best = { x, y }
          bestDistance = distance
        }
      }
    }
    return best ?? fallback
  }, surface)
  if (!point) throw new Error('canvas has no unobstructed React Flow pane point')
  return point
}

async function panRound(page, options = {}) {
  const surface = await page.locator('[data-canvas-surface]').boundingBox()
  if (!surface) throw new Error('canvas surface has no bounding box')
  const { x, y } = await blankPointerPoint(page, surface)
  await page.mouse.move(x, y)
  await page.mouse.down({ button: 'middle' })
  const intervals = await sampleFrames(page, async () => {
    for (let index = 0; index < (STRESS_MODE ? 40 : 24); index += 1) {
      const direction = index % 2 === 0 ? 1 : -1
      const stressX =
        direction > 0
          ? surface.x + surface.width * 0.86
          : surface.x + surface.width * 0.14
      await page.mouse.move(
        STRESS_MODE ? stressX : x + direction * 260,
        STRESS_MODE ? y : y + direction * 90,
        { steps: STRESS_MODE ? 18 : 4 },
      )
      await new Promise((resolve) => setTimeout(resolve, STRESS_MODE ? 35 : 50))
    }
  })
  const gesture = await page.evaluate(() => {
    const surface = document.querySelector('[data-canvas-surface]')
    const edges = document.querySelector('.react-flow__edges')
    const background = document.querySelector('.react-flow__background')
    const fastLayer = document.querySelector('[data-flow-viewport-edge-layer]')
    const fastBackground = document.querySelector('[data-viewport-background]')
    return {
      moving: surface?.getAttribute('data-viewport-moving') === 'true',
      edgeDisplay: edges ? getComputedStyle(edges).display : null,
      backgroundDisplay: background ? getComputedStyle(background).display : null,
      fastLayer: Boolean(fastLayer),
      fastPaths: fastLayer?.querySelectorAll('path').length ?? 0,
      fastBackground: fastBackground?.getAttribute('data-viewport-background') ?? null,
      coarseNodes: document.querySelectorAll('.react-flow__node-coarse').length,
      mountedNodes: document.querySelectorAll('.react-flow__node[data-id]').length,
      cullingVisibleNodes: document.querySelectorAll(
        '.react-flow__node[data-node-viewport-culled="visible"]',
      ).length,
      visibleImages: [...document.querySelectorAll('[data-node-type="generation"] img')]
        .filter((image) => {
          const rect = image.getBoundingClientRect()
          return (
            getComputedStyle(image).visibility !== 'hidden' &&
            rect.right > 0 &&
            rect.bottom > 0 &&
            rect.left < innerWidth &&
            rect.top < innerHeight
          )
        }).length,
    }
  })
  let screenshot = null
  if (options.screenshotPath) {
    await page.screenshot({ path: options.screenshotPath })
    screenshot = path.relative(ROOT, options.screenshotPath)
  }
  await page.mouse.up({ button: 'middle' })
  await page.waitForFunction(
    () =>
      !document
        .querySelector('[data-canvas-surface]')
        ?.hasAttribute('data-viewport-moving'),
    undefined,
    { timeout: 10_000 },
  )
  await page.waitForFunction(
    (expected) => document.querySelectorAll('.react-flow__node[data-id]').length === expected,
    PERFORMANCE_NODE_COUNT,
    { timeout: 10_000 },
  )
  gesture.restoredNodes = await page.locator('.react-flow__node[data-id]').count()
  return { intervals, gesture, screenshot }
}

async function settleLowZoomPan(page, targetZoom = 0.2) {
  await page.keyboard.press('z')
  await page.waitForTimeout(300)
  await settleZoomAt(page, targetZoom)
  await page.waitForTimeout(350)
}

async function lowZoomPanRound(page) {
  const surface = await page.locator('[data-canvas-surface]').boundingBox()
  if (!surface) throw new Error('canvas surface has no bounding box')
  const { x, y } = await blankPointerPoint(page, surface)
  await page.mouse.move(x, y)
  const before = await viewportState(page)
  await page.mouse.down({ button: 'middle' })
  const expectedFirstDelta = { x: 240, y: 140 }
  let firstFrame = null
  const intervals = await sampleFrames(page, async () => {
    await page.mouse.move(x + expectedFirstDelta.x, y + expectedFirstDelta.y, {
      steps: 1,
    })
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => resolve(null))),
    )
    firstFrame = await viewportState(page)
    for (let index = 0; index < 24; index += 1) {
      const direction = index % 2 === 0 ? 1 : -1
      await page.mouse.move(x + direction * 260, y + direction * 90, {
        steps: 4,
      })
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  })
  const gesture = await page.evaluate(() => {
    const surface = document.querySelector('[data-canvas-surface]')
    const images = [...document.querySelectorAll('[data-node-type="generation"] img')]
    return {
      moving: surface?.getAttribute('data-viewport-moving') === 'true',
      mode: surface?.getAttribute('data-viewport-mode') ?? null,
      coarseNodes: document.querySelectorAll('.react-flow__node-coarse').length,
      mountedNodes: document.querySelectorAll('.react-flow__node[data-id]').length,
      visibleImages: images.filter((image) => {
        const rect = image.getBoundingClientRect()
        return (
          getComputedStyle(image).visibility !== 'hidden' &&
          rect.right > 0 &&
          rect.bottom > 0 &&
          rect.left < innerWidth &&
          rect.top < innerHeight
        )
      }).length,
      hiddenImages: images.filter(
        (image) => getComputedStyle(image).visibility === 'hidden',
      ).length,
      promptCanvasVisible:
        getComputedStyle(document.querySelector('[data-prompt-gesture-canvas]')).display !==
        'none',
      hiddenPromptBodies: [...document.querySelectorAll(
        '[data-node-type="prompt"] [data-node-body]',
      )].filter((body) => getComputedStyle(body).visibility === 'hidden').length,
    }
  })
  await page.mouse.up({ button: 'middle' })
  await page.waitForFunction(
    () =>
      !document
        .querySelector('[data-canvas-surface]')
        ?.hasAttribute('data-viewport-moving'),
    undefined,
    { timeout: 10_000 },
  )
  gesture.restoredNodes = await page.locator('.react-flow__node[data-id]').count()
  const after = await viewportState(page)
  const firstFrameDelta =
    firstFrame?.domViewport && before.domViewport
      ? {
          x: firstFrame.domViewport.x - before.domViewport.x,
          y: firstFrame.domViewport.y - before.domViewport.y,
        }
      : null
  return {
    ...summarizeFrames(intervals),
    before,
    after,
    firstFrame,
    expectedFirstDelta,
    firstFrameDelta,
    gesture,
  }
}

async function zoomRound(page) {
  const surface = await page.locator('[data-canvas-surface]').boundingBox()
  if (!surface) throw new Error('canvas surface has no bounding box')
  const { x, y } = await blankPointerPoint(page, surface)
  await page.mouse.move(x, y)
  const intervals = await sampleFrames(page, async () => {
    if (STRESS_MODE) {
      for (let index = 0; index < 225; index += 1) {
        await page.mouse.wheel(0, index % 2 === 0 ? -160 : 160)
        await new Promise((resolve) => setTimeout(resolve, 35))
      }
      return
    }
    for (let index = 0; index < 24; index += 1) {
      // A small net zoom-in per round keeps every measured round below maxZoom
      // while still exercising both wheel directions.
      await page.mouse.wheel(0, index % 2 === 0 ? -140 : 120)
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  })
  const gesture = await page.evaluate(() => {
    const surface = document.querySelector('[data-canvas-surface]')
    return {
      moving: surface?.getAttribute('data-viewport-moving') === 'true',
      background: document.querySelector('[data-viewport-background]')?.getAttribute(
        'data-viewport-background',
      ) ?? null,
      fastLayer: Boolean(document.querySelector('[data-flow-viewport-edge-layer]')),
      coarseNodes: document.querySelectorAll('.react-flow__node-coarse').length,
      mountedEdges: document.querySelectorAll('.react-flow__edge').length,
      edgeDisplay: getComputedStyle(document.querySelector('.react-flow__edges')).display,
      mountedNodes: document.querySelectorAll('.react-flow__node[data-id]').length,
    }
  })
  await page.waitForFunction(
    (expected) => document.querySelectorAll('.react-flow__node[data-id]').length === expected,
    PERFORMANCE_NODE_COUNT,
    { timeout: 10_000 },
  )
  gesture.restoredNodes = await page.locator('.react-flow__node[data-id]').count()
  return { intervals, gesture }
}

async function settleZoomAt(page, targetZoom = 0.8) {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const state = await viewportState(page)
    const zoom = state.domViewport?.zoom
    if (!Number.isFinite(zoom)) break
    if (Math.abs(zoom - targetZoom) < 0.03) {
      await page.waitForFunction(
        () =>
          !document
            .querySelector('[data-canvas-surface]')
            ?.hasAttribute('data-viewport-moving'),
        undefined,
        { timeout: 10_000 },
      )
      await page.waitForTimeout(250)
      return
    }
    const surface = await page.locator('[data-canvas-surface]').boundingBox()
    if (!surface) throw new Error('canvas surface has no bounding box')
    const { x, y } = await blankPointerPoint(page, surface)
    await page.mouse.move(x, y)
    const ratio = targetZoom / zoom
    const wheelMagnitude = Math.max(
      8,
      Math.min(160, Math.abs((160 * Math.log(ratio)) / Math.log(1.248))),
    )
    await page.mouse.wheel(0, zoom < targetZoom ? -wheelMagnitude : wheelMagnitude)
    await page.waitForTimeout(60)
  }
  const state = await viewportState(page)
  throw new Error(
    `zoom warmup did not reach ${targetZoom}: ${state.domViewport?.zoom ?? 'unknown'}`,
  )
}

async function findDraggableGenerationNode(page) {
  const surface = await page.locator('[data-canvas-surface]').boundingBox()
  if (!surface) throw new Error('canvas surface has no bounding box')
  const candidate = await page.evaluate((bounds) => {
    const candidates = []
    for (const wrapper of document.querySelectorAll('.react-flow__node[data-id]')) {
      const rect = wrapper.getBoundingClientRect()
      if (
        rect.left < bounds.x + 80 ||
        rect.right > bounds.x + bounds.width - 80 ||
        rect.top < bounds.y + 80 ||
        rect.bottom > bounds.y + bounds.height - 120
      ) {
        continue
      }
      const x = rect.left + rect.width / 2
      const y = rect.top + rect.height / 2
      const target = document.elementFromPoint(x, y)
      const targetNode = target?.closest('[data-node-id]')
      const targetWrapper = target?.closest('.react-flow__node[data-id]')
      if (
        targetNode !== wrapper.querySelector('[data-node-id]') &&
        targetWrapper !== wrapper
      ) {
        continue
      }
      candidates.push({
        id: wrapper.getAttribute('data-id'),
        x,
        y,
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
      })
    }
    return candidates[0] ?? null
  }, surface)
  if (!candidate) throw new Error('no fully visible generation node to drag')
  return candidate
}

async function nodeDragRound(page) {
  const node = await findDraggableGenerationNode(page)
  const start = { x: node.x, y: node.y }
  const startRect = await page.locator(`.react-flow__node[data-id="${node.id}"]`).boundingBox()
  const viewport = page.viewportSize()
  const distance = STRESS_MODE ? 760 : 110
  const out = {
    x: Math.min((viewport?.width ?? 1440) - 100, start.x + distance),
    y: Math.min((viewport?.height ?? 900) - 120, start.y + distance * 0.5),
  }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  let midRect = null
  const intervals = await sampleFrames(page, async () => {
    try {
      for (let cycle = 0; cycle < (STRESS_MODE ? 4 : 6); cycle += 1) {
        await page.mouse.move(out.x, out.y, { steps: STRESS_MODE ? 24 : 12 })
        await page.waitForTimeout(STRESS_MODE ? 35 : 80)
        if (cycle === 0) {
          midRect = await page
            .locator(`.react-flow__node[data-id="${node.id}"]`)
            .boundingBox()
        }
        await page.mouse.move(start.x, start.y, { steps: STRESS_MODE ? 24 : 12 })
        await page.waitForTimeout(STRESS_MODE ? 35 : 80)
      }
    } finally {
      await page.mouse.up()
    }
  })
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  const finalRect = await page
    .locator(`.react-flow__node[data-id="${node.id}"]`)
    .boundingBox()
  const finalTransform = await page.evaluate(
    (id) =>
      document.querySelector(`.react-flow__node[data-id="${id}"]`)?.style.transform ??
      null,
    node.id,
  )
  const movedPx = midRect
    ? Math.hypot(midRect.x - node.left, midRect.y - node.top)
    : 0
  const finalDeltaPx = finalRect
    ? Math.hypot(finalRect.x - node.left, finalRect.y - node.top)
    : Number.POSITIVE_INFINITY
  return {
    intervals,
    movement: {
      nodeId: node.id,
      movedPx,
      finalDeltaPx,
      startRect,
      midRect,
      finalRect,
      finalTransform,
    },
  }
}

async function coldNodeDragRound(page) {
  const node = await findDraggableGenerationNode(page)
  const start = { x: node.x, y: node.y }
  const startRect = await page.locator(`.react-flow__node[data-id="${node.id}"]`).boundingBox()
  if (!startRect) throw new Error('cold drag node has no bounding box')
  await page.evaluate((id) => {
    const element = document.querySelector(`.react-flow__node[data-id="${id}"]`)
    window.__qhDragStyleLog = []
    window.__qhDragPointerLog = []
    window.__qhDragMouseLog = []
    window.__qhDragDownLog = []
    window.__qhDragInitialTransform = element?.style.transform ?? ''
    if (!element) return
    new MutationObserver(() => {
      window.__qhDragStyleLog.push({
        at: performance.now(),
        transform: element.style.transform,
      })
    }).observe(element, { attributes: true, attributeFilter: ['style', 'class'] })
    document.addEventListener(
      'pointerdown',
      (event) => {
        window.__qhDragDownLog.push({
          at: performance.now(),
          x: event.clientX,
          y: event.clientY,
        })
      },
      true,
    )
    document.addEventListener(
      'pointermove',
      (event) => {
        window.__qhDragPointerLog.push({
          at: performance.now(),
          x: event.clientX,
          y: event.clientY,
        })
      },
      true,
    )
    document.addEventListener(
      'mousemove',
      (event) => {
        window.__qhDragMouseLog.push({
          at: performance.now(),
          x: event.clientX,
          y: event.clientY,
        })
      },
      true,
    )
  }, node.id)
  const target = {
    x: Math.min((page.viewportSize()?.width ?? 1440) - 100, start.x + 760),
    y: Math.min((page.viewportSize()?.height ?? 900) - 120, start.y + 380),
  }
  const firstMove = page.evaluate(
    ({ id, initialLeft, initialTop }) =>
      new Promise((resolve) => {
        const element = document.querySelector(`.react-flow__node[data-id="${id}"]`)
        const started = performance.now()
        const tick = () => {
          const rect = element?.getBoundingClientRect()
          if (rect) {
            const dx = rect.left - initialLeft
            const dy = rect.top - initialTop
            if (Math.hypot(dx, dy) > 0.5) {
              resolve({ ms: performance.now() - started, dx, dy })
              return
            }
          }
          if (performance.now() - started > 4000) {
            resolve({ ms: null, dx: 0, dy: 0 })
            return
          }
          requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      }),
    { id: node.id, initialLeft: startRect.x, initialTop: startRect.y },
  )
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  const lagSamples = []
  let layersDuringDrag = null
  const intervals = await sampleFrames(page, async () => {
    try {
      for (let step = 1; step <= 24; step += 1) {
        const x = start.x + ((target.x - start.x) * step) / 24
        const y = start.y + ((target.y - start.y) * step) / 24
        await page.mouse.move(x, y)
        await page.evaluate(
          () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
        )
        const sample = await page.evaluate((id) => {
          const element = document.querySelector(`.react-flow__node[data-id="${id}"]`)
          if (!element) return null
          const rect = element.getBoundingClientRect()
          return {
            x: rect.left,
            y: rect.top,
            transform: element.style.transform,
          }
        }, node.id)
        if (sample) {
          lagSamples.push({
            x: sample.x - startRect.x - (x - start.x),
            y: sample.y - startRect.y - (y - start.y),
            expectedX: x - start.x,
            expectedY: y - start.y,
            actualX: sample.x - startRect.x,
            actualY: sample.y - startRect.y,
            transform: sample.transform,
          })
        }
        if (step === 6) {
          layersDuringDrag = await page.evaluate(() => ({
            directDrag: document
              .querySelector('[data-canvas-surface]')
              ?.getAttribute('data-direct-drag'),
            portLayer: Boolean(document.querySelector('[data-flow-port-layer]')),
            childHitLayer: Boolean(document.querySelector('[data-flow-child-edge-hit]')),
            draggingNodes: document.querySelectorAll('.react-flow__node.dragging').length,
            coarseNodes: document.querySelectorAll('.react-flow__node-coarse').length,
            hiddenImageNodes: [...document.querySelectorAll('[data-node-type="generation"] img')]
              .filter((image) => getComputedStyle(image).visibility === 'hidden').length,
          }))
        }
      }
      await page.waitForTimeout(120)
    } finally {
      await page.mouse.up()
    }
  }, 3500)
  const first = await firstMove
  const dragObserverLog = await page.evaluate(() => ({
    style: window.__qhDragStyleLog,
    pointer: window.__qhDragPointerLog,
    mouse: window.__qhDragMouseLog,
    down: window.__qhDragDownLog,
    initialTransform: window.__qhDragInitialTransform,
  }))
  const pointerLagMax = Math.max(
    0,
    ...lagSamples.map((sample) => Math.hypot(sample.x, sample.y)),
  )
  if (layersDuringDrag?.directDrag !== 'true') {
    throw new Error('node drag did not enter the direct DOM-follow path')
  }
  if (pointerLagMax > 4) {
    throw new Error(`node drag exceeded 4px pointer lag: ${pointerLagMax.toFixed(2)}px`)
  }
  await page.waitForFunction(
    (expected) => document.querySelectorAll('.react-flow__node[data-id]').length === expected,
    PERFORMANCE_NODE_COUNT,
    { timeout: 10_000 },
  )
  return {
    nodeId: node.id,
    firstMoveMs: first.ms,
    firstMoveDelta: { x: first.dx, y: first.dy },
    firstFramesMs: intervals.slice(0, 10),
    frames: summarizeFrames(intervals),
    dragObserverLog,
    firstMoveAfterDownMs: (() => {
      const down = dragObserverLog.down[0]
      const firstMotion = dragObserverLog.pointer.find(
        (sample) => sample.x !== start.x || sample.y !== start.y,
      )
      const changed = dragObserverLog.style.find(
        (sample) => sample.transform !== dragObserverLog.initialTransform,
      )
      return {
        pointer: down && firstMotion ? firstMotion.at - down.at : null,
        node: down && changed ? changed.at - down.at : null,
      }
    })(),
    pointerLag: {
      samples: lagSamples.length,
      raw: lagSamples,
      mean:
        lagSamples.reduce((sum, sample) => sum + Math.hypot(sample.x, sample.y), 0) /
        Math.max(1, lagSamples.length),
      max: pointerLagMax,
      maxX: Math.max(0, ...lagSamples.map((sample) => Math.abs(sample.x))),
      maxY: Math.max(0, ...lagSamples.map((sample) => Math.abs(sample.y))),
    },
    layersDuringDrag,
  }
}

async function waitForPerformancePage(page) {
  await page.locator('[data-canvas-hydrated="true"]').waitFor({ timeout: 60_000 })
  await page.waitForFunction(
    (expected) => document.querySelectorAll('.react-flow__node[data-id]').length === expected,
    PERFORMANCE_NODE_COUNT,
    { timeout: 60_000 },
  )
  await waitForImageEvidence(page)
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
    await page.waitForTimeout(900)
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
    const dragNode = await findDraggableGenerationNode(page)
    const dragStartRect = await page
      .locator(`.react-flow__node[data-id="${dragNode.id}"]`)
      .boundingBox()
    await page.mouse.move(dragNode.x, dragNode.y)
    await page.mouse.down()
    await page.mouse.move(dragNode.x + 80, dragNode.y + 40, { steps: 8 })
    await page.waitForTimeout(120)
    const dragMidRect = await page
      .locator(`.react-flow__node[data-id="${dragNode.id}"]`)
      .boundingBox()
    const dragPath = path.join(output, `drag-${name}.png`)
    await page.screenshot({ path: dragPath })
    await page.mouse.move(dragNode.x, dragNode.y, { steps: 8 })
    await page.mouse.move(dragNode.x, dragNode.y)
    await page.waitForTimeout(80)
    await page.mouse.up()
    await page.waitForTimeout(250)
    const dragFinalRect = await page
      .locator(`.react-flow__node[data-id="${dragNode.id}"]`)
      .boundingBox()
    const nodesAfterDrag = await page.locator('.react-flow__node').count()
    const dragMovedPx =
      dragStartRect && dragMidRect
        ? Math.hypot(
            dragMidRect.x - dragStartRect.x,
            dragMidRect.y - dragStartRect.y,
          )
        : 0
    const dragReturnedPx =
      dragStartRect && dragFinalRect
        ? Math.hypot(
            dragFinalRect.x - dragStartRect.x,
            dragFinalRect.y - dragStartRect.y,
          )
        : Number.POSITIVE_INFINITY
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
      drag: {
        nodeId: dragNode.id,
        movedPx: dragMovedPx,
        returnedPx: dragReturnedPx,
        nodesAfter: nodesAfterDrag,
        screenshot: path.relative(ROOT, dragPath),
      },
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
        pixelDiff.ratio <= 0.02 &&
        dragMovedPx >= 60 &&
        dragReturnedPx <= 2 &&
        nodesAfterDrag === PERFORMANCE_NODE_COUNT,
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
    Number.isInteger(configuredRounds) && configuredRounds > 0
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
  const panTracePath = path.join(runRoot, 'pan.trace.json')
  const panScreenshotPath = path.join(runRoot, 'pan-active.png')
  const dragTracePath = path.join(runRoot, 'drag.trace.json')

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

    if (process.env.QH_PERF_COLD_DRAG_ONLY === '1') {
      const coldDrags = []
      for (let round = 0; round < 3; round += 1) {
        if (round > 0) {
          await page.reload({ waitUntil: 'domcontentloaded' })
          await waitForPerformancePage(page)
          await page.waitForTimeout(1000)
        }
        coldDrags.push(await coldNodeDragRound(page))
      }
      const coldReport = {
        environment: {
          built: 'Tauri release + WebView2',
          viewport: await page.evaluate(() => ({
            width: window.innerWidth,
            height: window.innerHeight,
            devicePixelRatio: window.devicePixelRatio,
          })),
          releaseExe,
        },
        graph: {
          nodes: seeded.nodes.length,
          edges: seeded.edges.length,
          mountedNodes: await page.locator('.react-flow__node[data-id]').count(),
          mountedEdges: await page.locator('.react-flow__edge').count(),
        },
        images: imageEvidence,
        coldDrags,
        pageErrors,
        consoleErrors,
      }
      const coldReportPath = path.join(runRoot, 'cold-drag-report.json')
      fs.writeFileSync(coldReportPath, JSON.stringify(coldReport, null, 2))
      fs.writeFileSync(
        path.join(runRoot, 'cold-drag-REPORT.md'),
        [
          '# Cold node drag diagnostic',
          '',
          ...coldDrags.map(
            (round, index) =>
              `- round ${index + 1}: first move ${round.firstMoveMs?.toFixed(2) ?? 'missing'}ms; P95 ${round.frames.p95Ms.toFixed(2)}ms; max ${round.frames.maxMs.toFixed(2)}ms; pointer lag max ${round.pointerLag.max.toFixed(2)}px`,
          ),
          '',
        ].join('\n'),
      )
      console.log(JSON.stringify(coldReport, null, 2))
      console.log(`evidence: ${path.relative(ROOT, coldReportPath)}`)
      return
    }

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
    const dragRounds = []
    let performanceTrace = null
    let dragPerformanceTrace = null
    for (let round = 0; round < measurementRounds; round += 1) {
      const before = await viewportState(page)
      const performanceBefore = await readPerformanceMetrics(cdp)
      const stopTrace =
        round === 0 && process.env.QH_PERF_TRACE === '1'
          ? await beginPerformanceTrace(cdp)
          : null
      const result = await panRound(page, {
        screenshotPath:
          round === 0 && process.env.QH_PERF_PAN_SCREENSHOT === '1'
            ? panScreenshotPath
            : undefined,
      })
      const { intervals } = result
      const after = await viewportState(page)
      const performanceAfter = await readPerformanceMetrics(cdp)
      if (stopTrace) {
        const events = await stopTrace()
        fs.writeFileSync(panTracePath, JSON.stringify({ traceEvents: events }))
        performanceTrace = path.relative(ROOT, panTracePath)
      }
      panRounds.push({
        ...summarizeFrames(intervals),
        frameIntervalsMs: intervals,
        gesture: result.gesture,
        screenshot: result.screenshot,
        before,
        after,
        performanceMetrics: performanceMetricsDelta(performanceBefore, performanceAfter),
      })
      await page.waitForTimeout(250)
    }

    await settleLowZoomPan(page)
    await lowZoomPanRound(page)
    await page.waitForTimeout(350)
    const lowZoomPanRounds = []
    for (let round = 0; round < measurementRounds; round += 1) {
      await settleLowZoomPan(page)
      const performanceBefore = await readPerformanceMetrics(cdp)
      const result = await lowZoomPanRound(page)
      const performanceAfter = await readPerformanceMetrics(cdp)
      lowZoomPanRounds.push({
        ...result,
        performanceMetrics: performanceMetricsDelta(performanceBefore, performanceAfter),
      })
      await page.waitForTimeout(250)
    }

    await page.keyboard.press('z')
    await page.waitForTimeout(300)
    await settleZoomAt(page, 1)
    const warmupDrag = await nodeDragRound(page)
    if (!nodeDragRoundMovement({ movement: warmupDrag.movement }).pass) {
      throw new Error(
        `node drag warmup did not move and return the node: ${JSON.stringify(warmupDrag.movement)}`,
      )
    }
    await page.waitForTimeout(900)
    for (let round = 0; round < measurementRounds; round += 1) {
      const performanceBefore = await readPerformanceMetrics(cdp)
      const stopDragTrace =
        round === 0 && process.env.QH_PERF_DRAG_TRACE === '1'
          ? await beginPerformanceTrace(cdp)
          : null
      const result = await nodeDragRound(page)
      const performanceAfter = await readPerformanceMetrics(cdp)
      if (stopDragTrace) {
        const events = await stopDragTrace()
        fs.writeFileSync(dragTracePath, JSON.stringify({ traceEvents: events }))
        dragPerformanceTrace = path.relative(ROOT, dragTracePath)
      }
      dragRounds.push({
        ...summarizeFrames(result.intervals),
        frameIntervalsMs: result.intervals,
        movement: result.movement,
        performanceMetrics: performanceMetricsDelta(performanceBefore, performanceAfter),
      })
      await page.waitForTimeout(900)
    }

    // Pan leaves the viewport at a different origin. Precondition the zoom path
    // separately so round one measures steady-state zoom, not the phase switch.
    await settleZoomAt(page)
    await zoomRound(page)
    await page.waitForTimeout(250)
    for (let round = 0; round < measurementRounds; round += 1) {
      await page.keyboard.press('z')
      await page.waitForTimeout(300)
      const before = await viewportState(page)
      const performanceBefore = await readPerformanceMetrics(cdp)
      const result = await zoomRound(page)
      const { intervals } = result
      const after = await viewportState(page)
      const performanceAfter = await readPerformanceMetrics(cdp)
      zoomRounds.push({
        ...summarizeFrames(intervals),
        frameIntervalsMs: intervals,
        gesture: result.gesture,
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
      lowZoomPanRounds,
      zoomRounds,
      dragRounds,
      pageErrors,
      consoleErrors,
      uiMatrix,
      evidence: {
        canvasScreenshot: screenshot,
        appLog: path.relative(ROOT, appLogPath),
        performanceTrace,
        panScreenshot: fs.existsSync(panScreenshotPath)
          ? path.relative(ROOT, panScreenshotPath)
          : null,
        dragPerformanceTrace,
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
        `- low-zoom pan P95: ${lowZoomPanRounds.map((round) => round.p95Ms.toFixed(2) + 'ms').join(' / ')}`,
        `- low-zoom pan first frame: ${report.assertions.lowZoomPanFirstFrame.pass ? 'PASS' : 'FAIL'}`,
        `- low-zoom pan appearance: ${report.assertions.lowZoomPanAppearance.pass ? 'PASS' : 'FAIL'}`,
        `- zoom main-thread task: ${zoomRounds.map((round) => `${((round.performanceMetrics?.TaskDuration ?? 0) * 1000).toFixed(1)}ms`).join(' / ')}`,
        `- drag P95: ${dragRounds.map((round) => round.p95Ms.toFixed(2) + 'ms').join(' / ')}`,
        `- drag movement: ${report.assertions.dragMovement.rounds.map((round) => round.pass ? 'PASS' : 'FAIL').join(' / ')}`,
        `- drag worst frame: ${dragRounds.map((round) => round.maxMs.toFixed(2) + 'ms').join(' / ')}`,
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
