export interface BrowserWindowRect {
  x: number
  y: number
  width: number
  height: number
}

export interface BrowserWindowStage {
  width: number
  height: number
}

const MARGIN = 12
const MIN_WIDTH = 420
const MIN_HEIGHT = 280

function limit(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

function minimums(stage: BrowserWindowStage) {
  return {
    width: Math.min(MIN_WIDTH, Math.max(1, stage.width - MARGIN * 2)),
    height: Math.min(MIN_HEIGHT, Math.max(1, stage.height - MARGIN * 2)),
  }
}

export function fitBrowserWindow(
  stage: BrowserWindowStage,
  preferred: { width: number; height: number } = { width: 720, height: 520 },
): BrowserWindowRect {
  const min = minimums(stage)
  const maxWidth = Math.max(min.width, stage.width - MARGIN * 2)
  const maxHeight = Math.max(min.height, stage.height - MARGIN * 2)
  const width = limit(preferred.width, min.width, maxWidth)
  const height = limit(preferred.height, min.height, maxHeight)
  return {
    x: limit((stage.width - width) / 2, MARGIN, stage.width - width - MARGIN),
    y: limit((stage.height - height) / 2, MARGIN, stage.height - height - MARGIN),
    width,
    height,
  }
}

export function moveBrowserWindow(
  start: BrowserWindowRect,
  dx: number,
  dy: number,
  stage: BrowserWindowStage,
): BrowserWindowRect {
  return {
    ...start,
    x: limit(start.x + dx, MARGIN, stage.width - start.width - MARGIN),
    y: limit(start.y + dy, MARGIN, stage.height - start.height - MARGIN),
  }
}

export function resizeBrowserWindow(
  start: BrowserWindowRect,
  dw: number,
  dh: number,
  stage: BrowserWindowStage,
): BrowserWindowRect {
  const min = minimums(stage)
  return {
    ...start,
    width: limit(
      start.width + dw,
      min.width,
      stage.width - start.x - MARGIN,
    ),
    height: limit(
      start.height + dh,
      min.height,
      stage.height - start.y - MARGIN,
    ),
  }
}
