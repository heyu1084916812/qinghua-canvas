import { describe, expect, it } from 'vitest'
import { imageSizeFromHeader } from '../src/domain/shared/imageSize'
import {
  ASSET_SIZE,
  GENERATION_NODE_COUNT,
  PERFORMANCE_EDGE_COUNT,
  PERFORMANCE_NODE_COUNT,
  THUMB_SIZE,
  buildPerformanceReport,
  bytesFromMarker,
  nodeDragRoundMovement,
  seedGraph,
  summarizeFrames,
  viewportRoundMovement,
} from './test-canvas-performance.mjs'

const seed = seedGraph()

function passingInput() {
  const viewport = (x, y, zoom) => ({
    domViewport: { x, y, zoom },
    rfViewport: `${Math.round(x)},${Math.round(y)}@${zoom.toFixed(2)}`,
    storeViewport: `${Math.round(x)},${Math.round(y)}@${zoom.toFixed(2)}`,
  })
  return {
    environment: { built: 'test' },
    graph: {
      nodes: PERFORMANCE_NODE_COUNT,
      edges: PERFORMANCE_EDGE_COUNT,
      mountedNodes: PERFORMANCE_NODE_COUNT,
      mountedEdges: PERFORMANCE_EDGE_COUNT,
    },
    assets: { expectedRows: GENERATION_NODE_COUNT },
    imageEvidence: {
      renderedImages: GENERATION_NODE_COUNT,
      decodedImages: GENERATION_NODE_COUNT,
      thumbnailImages: GENERATION_NODE_COUNT,
      expectedWidthImages: GENERATION_NODE_COUNT,
    },
    panRounds: [18, 19, 20].map((p95Ms, index) => ({
      p95Ms,
      before: viewport(-index * 260, -index * 90, 1),
      after: viewport(-(index + 1) * 260, -(index + 1) * 90, 1),
      gesture: {
        moving: true,
        edgeDisplay: 'none',
        backgroundDisplay: 'none',
        fastLayer: true,
        fastPaths: 1,
        fastBackground: 'dots',
        mountedNodes: 63,
        restoredNodes: PERFORMANCE_NODE_COUNT,
      },
    })),
    zoomRounds: [17, 18, 19].map((p95Ms, index) => ({
      p95Ms,
      before: viewport(0, 0, 0.8),
      after: viewport(0, 0, 0.84 + index * 0.02),
      gesture: {
        moving: true,
        background: 'dots',
        fastLayer: true,
        mountedEdges: 0,
        mountedNodes: 63,
        restoredNodes: PERFORMANCE_NODE_COUNT,
      },
    })),
    dragRounds: [18, 19, 20].map((p95Ms) => ({
      p95Ms,
      movement: { nodeId: 'perf-node-001', movedPx: 123, finalDeltaPx: 0.2 },
    })),
    pageErrors: [],
    consoleErrors: [],
    evidence: { canvasScreenshot: 'canvas.png' },
  }
}

describe('canvas performance probe seed', () => {
  it('binds all 150 generation nodes to real asset fields', () => {
    const generationNodes = seed.nodes.filter((node) => node.type === 'generation')
    expect(seed.nodes).toHaveLength(PERFORMANCE_NODE_COUNT)
    expect(seed.edges).toHaveLength(PERFORMANCE_EDGE_COUNT)
    expect(generationNodes).toHaveLength(GENERATION_NODE_COUNT)
    expect(
      generationNodes.every(
        (node) =>
          /^[a-f0-9]{16}$/.test(node.data.assetHash) &&
          node.data.assetMime === 'image/png' &&
          node.data.naturalSize?.width === ASSET_SIZE &&
          node.data.naturalSize?.height === ASSET_SIZE &&
          node.data.thumbOrder?.length === 1 &&
          node.data.thumbOrder[0] === node.data.assetHash,
      ),
    ).toBe(true)
    expect(new Set(generationNodes.map((node) => node.data.assetHash)).size).toBe(
      GENERATION_NODE_COUNT,
    )
  })

  it('creates 150 asset rows with decodable PNG and WebP binary markers', () => {
    expect(seed.assets).toHaveLength(GENERATION_NODE_COUNT)
    for (const asset of seed.assets) {
      expect(asset).toMatchObject({
        id: asset.hash,
        hash: asset.hash,
        mime: 'image/png',
        thumbMime: 'image/webp',
        bytesLength: expect.any(Number),
        thumbLength: expect.any(Number),
      })
      expect(asset.id).toMatch(/^[a-f0-9]{16}$/)
      expect(asset.contentSha1).toMatch(/^[a-f0-9]{40}$/)
      expect(asset.contentSha1.startsWith(asset.hash)).toBe(true)

      const png = bytesFromMarker(asset.bytes)
      const webp = bytesFromMarker(asset.thumb)
      expect(png.length).toBe(asset.bytesLength)
      expect(webp.length).toBe(asset.thumbLength)
      expect(png.subarray(0, 8)).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      )
      expect(webp.subarray(0, 4).toString('ascii')).toBe('RIFF')
      expect(webp.subarray(8, 12).toString('ascii')).toBe('WEBP')
      expect(imageSizeFromHeader(png)).toEqual({
        width: ASSET_SIZE,
        height: ASSET_SIZE,
      })
      expect(imageSizeFromHeader(webp)).toEqual({
        width: THUMB_SIZE,
        height: THUMB_SIZE,
      })
    }
  })
})

describe('canvas performance report gate', () => {
  it('records renderedImages and decodedImages in the report', () => {
    const report = buildPerformanceReport(passingInput())
    expect(report.ok).toBe(true)
    expect(report.images.renderedImages).toBe(GENERATION_NODE_COUNT)
    expect(report.images.decodedImages).toBe(GENERATION_NODE_COUNT)
    expect(report.assertions.renderedImages).toEqual({
      expected: GENERATION_NODE_COUNT,
      actual: GENERATION_NODE_COUNT,
      pass: true,
    })
    expect(report.assertions.decodedImages.pass).toBe(true)
  })

  it('fails when only 149 generation images render or decode', () => {
    const missingRender = passingInput()
    missingRender.imageEvidence.renderedImages = GENERATION_NODE_COUNT - 1
    expect(buildPerformanceReport(missingRender).ok).toBe(false)

    const missingDecode = passingInput()
    missingDecode.imageEvidence.decodedImages = GENERATION_NODE_COUNT - 1
    const report = buildPerformanceReport(missingDecode)
    expect(report.ok).toBe(false)
    expect(report.assertions.decodedImages.pass).toBe(false)
  })

  it('keeps the 20ms P95 threshold for all six rounds', () => {
    const slow = passingInput()
    slow.panRounds[1].p95Ms = 20.01
    const report = buildPerformanceReport(slow)
    expect(report.ok).toBe(false)
    expect(report.assertions.panP95).toMatchObject({
      maximumMs: 20,
      pass: false,
    })
  })

  it('fails when the pan fast path never replaces layers or windows nodes', () => {
    const missingFastPath = passingInput()
    missingFastPath.panRounds[1].gesture = {
      ...missingFastPath.panRounds[1].gesture,
      fastLayer: false,
      mountedNodes: PERFORMANCE_NODE_COUNT,
    }
    const report = buildPerformanceReport(missingFastPath)
    expect(report.ok).toBe(false)
    expect(report.assertions.panFastPath.pass).toBe(false)
  })

  it('fails when a pan round leaves the viewport stationary', () => {
    const stalled = passingInput()
    stalled.panRounds[1] = {
      ...stalled.panRounds[1],
      after: stalled.panRounds[1].before,
    }
    const report = buildPerformanceReport(stalled)
    expect(report.ok).toBe(false)
    expect(report.assertions.panMovement.pass).toBe(false)
    expect(viewportRoundMovement(stalled.panRounds[1], 'pan')).toEqual({
      dom: false,
      store: false,
      pass: false,
    })
  })

  it('fails when a zoom round ends at the same scale', () => {
    const stalled = passingInput()
    stalled.zoomRounds[0] = {
      ...stalled.zoomRounds[0],
      after: stalled.zoomRounds[0].before,
    }
    const report = buildPerformanceReport(stalled)
    expect(report.ok).toBe(false)
    expect(report.assertions.zoomMovement.pass).toBe(false)
  })

  it('fails when zoom never enters the windowed fast path', () => {
    const missingFastPath = passingInput()
    missingFastPath.zoomRounds[1].gesture = {
      ...missingFastPath.zoomRounds[1].gesture,
      fastLayer: false,
      mountedEdges: PERFORMANCE_EDGE_COUNT,
      mountedNodes: PERFORMANCE_NODE_COUNT,
    }
    const report = buildPerformanceReport(missingFastPath)
    expect(report.ok).toBe(false)
    expect(report.assertions.zoomFastPath.pass).toBe(false)
  })

  it('fails when node dragging does not move the node', () => {
    const stalled = passingInput()
    stalled.dragRounds[1] = {
      ...stalled.dragRounds[1],
      movement: { nodeId: 'perf-node-001', movedPx: 0, finalDeltaPx: 0 },
    }
    const report = buildPerformanceReport(stalled)
    expect(report.ok).toBe(false)
    expect(report.assertions.dragMovement.pass).toBe(false)
    expect(nodeDragRoundMovement(stalled.dragRounds[1])).toEqual({
      movedPx: 0,
      finalDeltaPx: 0,
      pass: false,
    })
  })

  it('fails when a node drag round exceeds 20ms P95', () => {
    const slow = passingInput()
    slow.dragRounds[2].p95Ms = 20.01
    const report = buildPerformanceReport(slow)
    expect(report.ok).toBe(false)
    expect(report.assertions.dragP95.pass).toBe(false)
  })

  it('reports tail-frame diagnostics without relaxing the P95 gate', () => {
    const stats = summarizeFrames([16.7, 17.1, 19.5, 21, 34])
    expect(stats).toMatchObject({
      frames: 5,
      over20Frames: 2,
      over33Frames: 1,
      maxMs: 34,
    })
    expect(stats.p95Ms).toBe(34)
  })

  it('fails the gate when the culling UI matrix differs from the old rendering', () => {
    const changed = passingInput()
    changed.uiMatrix = {
      pass: false,
      rounds: [{ viewport: '1440x900-light', pass: false }],
    }
    const report = buildPerformanceReport(changed)
    expect(report.ok).toBe(false)
    expect(report.assertions.uiMatrix).toEqual({ rounds: 1, pass: false })
  })
})
