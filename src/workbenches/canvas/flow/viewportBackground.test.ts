// @ts-expect-error -- tests read source CSS without adding Node types to the app
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { viewportBackgroundMetrics, viewportDotPattern } from './viewportBackground'

const css = fs.readFileSync(
  new URL('./FlowViewportBackground.module.css', import.meta.url),
  'utf8',
)
const source = fs.readFileSync(
  new URL('./FlowViewportBackground.tsx', import.meta.url),
  'utf8',
)
const runtimeSource = fs.readFileSync(
  new URL('./viewportBackgroundRuntime.ts', import.meta.url),
  'utf8',
)

describe('viewport gesture background metrics', () => {
  it('matches React Flow dot geometry at 100%', () => {
    expect(
      viewportBackgroundMetrics({ x: -180, y: -90, zoom: 1 }),
    ).toEqual({
      size: '22px 22px',
      position: '180px 90px',
    })
  })

  it('scales the pattern and dot mask with zoom instead of using fixed pixels', () => {
    expect(
      viewportBackgroundMetrics({ x: 0, y: 0, zoom: 0.5 }),
    ).toEqual({
      size: '11px 11px',
      position: '0px 0px',
    })
    expect(
      viewportBackgroundMetrics({ x: -100, y: -60, zoom: 2 }),
    ).toEqual({
      size: '44px 44px',
      position: '200px 120px',
    })
  })

  it('falls back to 100% for an invalid zoom', () => {
    expect(
      viewportBackgroundMetrics({ x: 12, y: -8, zoom: 0 }),
    ).toEqual({
      size: '22px 22px',
      position: '-12px 8px',
    })
  })

  it('uses a scaled tile background instead of a fixed-pixel gradient', () => {
    expect(css).toContain('background-size: var(--viewport-pattern-size, 22px 22px)')
    expect(css).not.toContain('radial-gradient(')
  })

  it('builds a color-safe SVG tile with the original circle geometry', () => {
    const pattern = decodeURIComponent(viewportDotPattern('#303030'))
    expect(pattern).toContain('width="22" height="22"')
    expect(pattern).toContain('cx="11.7" cy="11.7" r="0.7"')
    expect(pattern).toContain('fill="#303030"')
    expect(decodeURIComponent(viewportDotPattern('url(javascript:bad)'))).toContain(
      'fill="transparent"',
    )
  })

  it('invalidates the cached SVG color when the theme changes', () => {
    expect(runtimeSource).toContain("attributeFilter: ['data-theme']")
    expect(runtimeSource).toContain('requestAnimationFrame(refresh)')
    expect(source).toContain('dotPatternRef.current = null')
    expect(source).toContain('watchViewportBackgroundTheme')
  })
})
