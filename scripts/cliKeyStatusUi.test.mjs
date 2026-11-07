import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const probe = fs.readFileSync(
  path.resolve(import.meta.dirname, 'verify-cli-key-status-ui.mjs'),
  'utf8',
)
const launcher = fs.readFileSync(
  path.resolve(import.meta.dirname, 'run-cli-key-status-ui.mjs'),
  'utf8',
)
const cliPanel = fs.readFileSync(
  path.resolve(import.meta.dirname, '../src/features/settings/CliPanel.tsx'),
  'utf8',
)

describe('CLI empty status UI gate', () => {
  it('covers four viewport/theme combinations and verifies the isolated credential write', () => {
    expect(probe).toContain("'1440x900'")
    expect(probe).toContain("'1024x700'")
    expect(probe).toContain("['light', 'dark']")
    expect(probe).toContain('containsSecret')
    expect(probe).toContain('没有配置状态命令，已跳过自动查询')
    expect(probe).toContain('statusOutput === 0')
    expect(probe).toContain('panelOverflowX')
    expect(probe).toContain('scrollIntoViewIfNeeded')
  })

  it('launches an isolated release and kills only its own pid', () => {
    expect(launcher).toContain('QINGHUA_RELEASE_GATE_DATA_DIR: dataDir')
    expect(launcher).toContain("APPDATA: localAppData")
    expect(launcher).toContain("QINGHUA_DISABLE_UI_WATCHDOG: '1'")
    expect(launcher).toContain('QH_CLI_UI_RUNTIME_ROOT: runRoot')
    expect(launcher).toContain("'/PID', String(app.pid), '/T', '/F'")
    expect(launcher).not.toMatch(/\/IM\b/)
  })

  it('does not read a null currentTarget from the details toggle event', () => {
    expect(cliPanel).toContain('event.target instanceof HTMLDetailsElement')
    expect(cliPanel).not.toContain('event.currentTarget.open')
  })
})
