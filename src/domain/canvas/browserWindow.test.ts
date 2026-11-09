import { describe, expect, it } from 'vitest'
import {
  fitBrowserWindow,
  moveBrowserWindow,
  resizeBrowserWindow,
} from './browserWindow'

describe('canvas browser window geometry', () => {
  it('fits a centered window inside the current canvas', () => {
    expect(fitBrowserWindow({ width: 1024, height: 700 })).toEqual({
      x: 152,
      y: 90,
      width: 720,
      height: 520,
    })
  })

  it('keeps dragging inside the canvas margins', () => {
    const start = { x: 100, y: 100, width: 500, height: 400 }
    expect(moveBrowserWindow(start, -500, -500, { width: 1200, height: 800 }))
      .toEqual({ x: 12, y: 12, width: 500, height: 400 })
    expect(moveBrowserWindow(start, 500, 500, { width: 1200, height: 800 }))
      .toEqual({ x: 600, y: 388, width: 500, height: 400 })
  })

  it('clamps resize to both the minimum and the canvas edge', () => {
    const start = { x: 300, y: 200, width: 500, height: 400 }
    expect(resizeBrowserWindow(start, -900, -900, { width: 1024, height: 700 }))
      .toEqual({ x: 300, y: 200, width: 420, height: 280 })
    expect(resizeBrowserWindow(start, 900, 900, { width: 1024, height: 700 }))
      .toEqual({ x: 300, y: 200, width: 712, height: 488 })
  })
})
