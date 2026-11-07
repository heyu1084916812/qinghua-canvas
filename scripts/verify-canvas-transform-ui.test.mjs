import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const source = fs.readFileSync(
  path.resolve(import.meta.dirname, 'verify-canvas-transform-ui.mjs'),
  'utf8',
)
const launcher = fs.readFileSync(
  path.resolve(import.meta.dirname, 'run-canvas-transform-ui.mjs'),
  'utf8',
)

describe('canvas transform UI gate probe', () => {
  it('captures four viewport/theme combinations before and after', () => {
    expect(source).toContain("'1440x900'")
    expect(source).toContain("'1024x700'")
    expect(source).toContain("['light', 'dark']")
    expect(source).toContain("report.before[key]")
    expect(source).toContain("report.after[key]")
    expect(source).toContain("content-visibility: ${contentVisibility ? 'auto' : 'visible'}")
    expect(source).toContain("node.contentVisibility === 'visible'")
    expect(source).toContain("after.nodes[index].contentVisibility === 'auto'")
    expect(source).toContain('nodeTextOverflow')
    expect(source).toContain('pageErrors')
    expect(source).toContain('compareScreenshots')
    expect(source).toContain('pixelDiff.ratio <= 0.02')
  })
})

describe('canvas transform UI launcher', () => {
  it('starts an isolated release and kills only its own pid', () => {
    expect(launcher).toContain('QINGHUA_RELEASE_GATE_DATA_DIR: dataDir')
    expect(launcher).toContain("'/PID', String(app.pid), '/T', '/F'")
    expect(launcher).not.toMatch(/\/IM\b/)
    expect(launcher).not.toContain('Stop-Process')
  })
})
