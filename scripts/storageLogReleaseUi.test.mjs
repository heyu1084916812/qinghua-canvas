import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (name) =>
  fs.readFileSync(path.resolve(import.meta.dirname, name), 'utf8')

describe('storage and log release UI probe', () => {
  it('uses an isolated release profile and kills only the app pid it owns', () => {
    const launcher = read('run-storage-log-release-ui.mjs')
    expect(launcher).toContain('QINGHUA_RELEASE_GATE_DATA_DIR: dataDir')
    expect(launcher).toContain('LOCALAPPDATA: localAppData')
    expect(launcher).toContain('APPDATA: localAppData')
    expect(launcher).toContain("QINGHUA_DISABLE_UI_WATCHDOG: '1'")
    expect(launcher).toContain("'/PID', String(app.pid), '/T', '/F'")
    expect(launcher).not.toMatch(/\/IM\b/)
  })

  it('measures the desktop storage fields and both log pages', () => {
    const probe = read('verify-storage-log-release-ui.mjs')
    expect(probe).toContain('storageQuickMs')
    expect(probe).toContain('storageFullMs')
    expect(probe).toContain('globalLogsMs')
    expect(probe).toContain('canvasLogsMs')
    expect(probe).toContain('[data-storage-media=')
    expect(probe).toContain('[data-storage-data-dir]')
    expect(probe).toContain('[data-storage-cache]')
    expect(probe).toContain('release:')
    expect(probe).toContain('sha256')
  })
})
