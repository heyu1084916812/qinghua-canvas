import { useLayoutEffect, useRef } from 'react'
import { useCanvasStore, useGraph, useSelection } from '../storeContext'
import styles from './FlowPromptGestureCanvas.module.css'

const SNAPSHOT_PADDING = 32
const SNAPSHOT_MAX_SIDE = 6144
const SNAPSHOT_MAX_AREA = 18_000_000

function addRoundedRect(
  path: Path2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
) {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2))
  path.moveTo(x + r, y)
  path.lineTo(x + w - r, y)
  path.quadraticCurveTo(x + w, y, x + w, y + r)
  path.lineTo(x + w, y + h - r)
  path.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  path.lineTo(x + r, y + h)
  path.quadraticCurveTo(x, y + h, x, y + h - r)
  path.lineTo(x, y + r)
  path.quadraticCurveTo(x, y, x + r, y)
  path.closePath()
}

/**
 * Prompt cards are the remaining low-zoom paint hotspot: 150 editable nodes
 * carry textareas, toolbars and buttons. During viewport motion we keep their
 * real card geometry, fill, border, selected state and text, but paint them in
 * one graph-wide snapshot. The layer is intentionally pan-only; wheel zoom
 * keeps the normal prompt DOM because every wheel step changes the scale.
 */
export function FlowPromptGestureCanvas() {
  const store = useCanvasStore()
  const graph = useGraph()
  const selection = useSelection()
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    const surface = canvas?.closest<HTMLElement>('[data-canvas-surface]')
    if (!canvas || !surface) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let frame = 0
    let snapshot: { x: number; y: number; zoom: number } | null = null
    const promptNodes = graph.nodes.filter(
      (node) => node.type === 'prompt' && !node.parentId,
    )
    const selectedIds = new Set(selection)

    const draw = () => {
      frame = 0
      if (!surface.hasAttribute('data-viewport-moving')) return
      if (surface.getAttribute('data-viewport-mode') !== 'pan') return
      const rect = surface.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      const computed = getComputedStyle(surface)
      const viewport = store.getViewport()
      const zoom = Math.max(0.01, viewport.zoom || 1)
      const fill = computed.getPropertyValue('--node-fill').trim()
      const border = computed.getPropertyValue('--node-border').trim()
      const focus = computed.getPropertyValue('--stroke-focus').trim()
      const text = computed.getPropertyValue('--text-2').trim()
      const radius = Number.parseFloat(computed.getPropertyValue('--radius-node')) || 12

      const snapshotMode = promptNodes.length > 0
      if (snapshotMode) {
        const minX = Math.min(...promptNodes.map((node) => node.x)) - SNAPSHOT_PADDING
        const minY = Math.min(...promptNodes.map((node) => node.y)) - SNAPSHOT_PADDING
        const maxX =
          Math.max(...promptNodes.map((node) => node.x + node.w)) + SNAPSHOT_PADDING
        const maxY =
          Math.max(...promptNodes.map((node) => node.y + node.h)) + SNAPSHOT_PADDING
        const snapshotWidth = (maxX - minX) * zoom
        const snapshotHeight = (maxY - minY) * zoom
        if (
          snapshotWidth <= SNAPSHOT_MAX_SIDE &&
          snapshotHeight <= SNAPSHOT_MAX_SIDE &&
          snapshotWidth * snapshotHeight <= SNAPSHOT_MAX_AREA
        ) {
          const pixelWidth = Math.max(1, Math.ceil(snapshotWidth * dpr))
          const pixelHeight = Math.max(1, Math.ceil(snapshotHeight * dpr))
          if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
            canvas.width = pixelWidth
            canvas.height = pixelHeight
          }
          canvas.style.left = `${(minX - viewport.x) * zoom}px`
          canvas.style.top = `${(minY - viewport.y) * zoom}px`
          canvas.style.right = 'auto'
          canvas.style.bottom = 'auto'
          canvas.style.width = `${snapshotWidth}px`
          canvas.style.height = `${snapshotHeight}px`
          canvas.style.transform = 'translate(0px, 0px)'
          snapshot = { x: viewport.x, y: viewport.y, zoom }

          ctx.setTransform(
            dpr * zoom,
            0,
            0,
            dpr * zoom,
            -minX * zoom * dpr,
            -minY * zoom * dpr,
          )
          ctx.clearRect(minX, minY, maxX - minX, maxY - minY)
          drawPromptNodes(ctx, promptNodes, selectedIds, zoom, {
            fill,
            border,
            focus,
            text,
            radius,
          })
          return
        }
      }

      snapshot = null
      if (canvas.width !== Math.round(rect.width * dpr)) {
        canvas.width = Math.round(rect.width * dpr)
        canvas.height = Math.round(rect.height * dpr)
      }
      canvas.style.left = '0px'
      canvas.style.top = '0px'
      canvas.style.right = 'auto'
      canvas.style.bottom = 'auto'
      canvas.style.width = `${rect.width}px`
      canvas.style.height = `${rect.height}px`
      canvas.style.transform = 'translate(0px, 0px)'
      ctx.setTransform(
        dpr * zoom,
        0,
        0,
        dpr * zoom,
        -viewport.x * zoom * dpr,
        -viewport.y * zoom * dpr,
      )
      ctx.clearRect(viewport.x, viewport.y, rect.width / zoom, rect.height / zoom)
      const visible = promptNodes.filter(
        (node) =>
          node.x + node.w >= viewport.x - 32 / zoom &&
          node.y + node.h >= viewport.y - 32 / zoom &&
          node.x <= viewport.x + (rect.width + 32) / zoom &&
          node.y <= viewport.y + (rect.height + 32) / zoom,
      )
      drawPromptNodes(ctx, visible, selectedIds, zoom, {
        fill,
        border,
        focus,
        text,
        radius,
      })
    }

    const applyPanTransform = () => {
      const viewport = store.getViewport()
      if (
        snapshot &&
        surface.getAttribute('data-viewport-mode') === 'pan' &&
        Math.abs(viewport.zoom - snapshot.zoom) < 0.001
      ) {
        canvas.style.transform = `translate(${(snapshot.x - viewport.x) * snapshot.zoom}px, ${
          (snapshot.y - viewport.y) * snapshot.zoom
        }px)`
        return
      }
      schedule()
    }
    const schedule = () => {
      if (frame) return
      frame = requestAnimationFrame(draw)
    }
    const observer = new MutationObserver(schedule)
    observer.observe(surface, {
      attributes: true,
      attributeFilter: ['data-viewport-moving', 'data-viewport-mode'],
    })
    const unsubscribe = store.subscribeViewport(applyPanTransform)
    const resize = new ResizeObserver(schedule)
    resize.observe(surface)
    schedule()
    return () => {
      unsubscribe()
      observer.disconnect()
      resize.disconnect()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [graph, selection, store])

  return <canvas ref={canvasRef} className={styles.canvas} data-prompt-gesture-canvas />
}

function drawPromptNodes(
  ctx: CanvasRenderingContext2D,
  nodes: ReturnType<typeof useGraph>['nodes'],
  selectedIds: ReadonlySet<string>,
  zoom: number,
  style: {
    fill: string
    border: string
    focus: string
    text: string
    radius: number
  },
) {
  const normalPath = new Path2D()
  const disabledPath = new Path2D()
  const selectedPath = new Path2D()
  const labels: { x: number; y: number; width: number; text: string }[] = []
  for (const node of nodes) {
    if (node.type !== 'prompt' || node.parentId) continue
    const path = node.disabled ? disabledPath : normalPath
    addRoundedRect(path, node.x, node.y, node.w, node.h, style.radius)
    if (selectedIds.has(node.id)) {
      addRoundedRect(selectedPath, node.x, node.y, node.w, node.h, style.radius)
    }
    const text =
      typeof (node.data as { text?: unknown }).text === 'string'
        ? (node.data as { text: string }).text.replace(/\s+/g, ' ').trim()
        : ''
    if (text) {
      labels.push({
        x: node.x + 10,
        y: node.y + 10,
        width: node.w - 20,
        text: text.slice(0, 96),
      })
    }
  }

  ctx.fillStyle = style.fill
  ctx.fill(normalPath)
  ctx.globalAlpha = 0.55
  ctx.fill(disabledPath)
  ctx.globalAlpha = 1
  ctx.strokeStyle = style.border
  ctx.lineWidth = 1 / zoom
  ctx.stroke(normalPath)
  ctx.globalAlpha = 0.55
  ctx.stroke(disabledPath)
  ctx.globalAlpha = 1
  ctx.strokeStyle = style.focus
  ctx.lineWidth = 2 / zoom
  ctx.stroke(selectedPath)
  ctx.fillStyle = style.text
  ctx.textBaseline = 'top'
  ctx.font = `12px sans-serif`
  for (const label of labels) {
    ctx.fillText(label.text, label.x, label.y, label.width)
  }
}
