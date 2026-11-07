import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const source = fs.readFileSync(
  path.resolve(import.meta.dirname, 'run-canvas-image-diagnosis.mjs'),
  'utf8',
)

describe('canvas image diagnosis launcher contract', () => {
  it('uses isolated ports, data dir, and CDP arguments', () => {
    expect(source).toContain('canvas-image-diagnosis-${timestamp}')
    expect(source).toContain('QINGHUA_RELEASE_GATE_DATA_DIR: dataDir')
    expect(source).toContain('QINGHUA_SHARED_STORE_PORT: String(storePort)')
    expect(source).toContain('LOCALAPPDATA: localAppData')
    expect(source).toContain("QINGHUA_RELEASE_GATE: '1'")
    expect(source).toContain('`--remote-debugging-port=${cdpPort}`')
    expect(source).toContain("'--no-proxy-server'")
    expect(source).toContain("'--disable-background-timer-throttling'")
    expect(source).toContain("'--disable-backgrounding-occluded-windows'")
    expect(source).toContain("'--disable-renderer-backgrounding'")
    expect(source).toContain('18772')
    expect(source).toContain('9445')
  })

  it('refuses reserved ports and busy probe ports', () => {
    expect(source).toContain('new Set([1420, 18765, 18766, 18791])')
    expect(source).toContain('assertProbePortsFree([storePort, cdpPort])')
    expect(source).toContain('is already in use; not touching it')
  })

  it('kills only its own spawned app pid and waits for port release', () => {
    expect(source).toContain("'/PID', String(app.pid), '/T', '/F'")
    expect(source).toContain('waitForPortRelease(storePort)')
    expect(source).toContain('waitForPortRelease(cdpPort)')
    expect(source).not.toMatch(/\/IM\b/)
    expect(source).not.toContain('Stop-Process')
  })

  it('stays diagnosis only and never asserts P95 acceptance', () => {
    expect(source).toContain('Diagnosis only')
    expect(source).not.toContain('MAX_P95_MS')
    expect(source).not.toContain('p95Ms >')
    expect(source).toContain('not acceptance evidence')
  })

  it('fails when the release exe predates dist instead of bypassing mtime', () => {
    expect(source).toContain('older than dist')
    expect(source).toContain('mtimeMs')
    expect(source).not.toContain('utimes')
  })
})
