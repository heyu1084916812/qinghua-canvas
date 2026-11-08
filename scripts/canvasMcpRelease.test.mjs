import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (name) =>
  fs.readFileSync(path.resolve(import.meta.dirname, name), 'utf8')

describe('real Canvas MCP release harness', () => {
  it('runs a clean release profile and kills only its own app pid', () => {
    const launcher = read('run-canvas-mcp-release.mjs')
    expect(launcher).toContain('QINGHUA_RELEASE_GATE_DATA_DIR: dataDir')
    expect(launcher).toContain('LOCALAPPDATA: localAppData')
    expect(launcher).toContain('APPDATA: localAppData')
    expect(launcher).toContain('QINGHUA_CANVAS_GATEWAY_PORT: String(gatewayPort)')
    expect(launcher).toContain("'/PID', String(app.pid), '/T', '/F'")
    expect(launcher).not.toMatch(/\/IM\b/)
  })

  it('reads a seeded real canvas and rejects protected tools', () => {
    const probe = read('verify-canvas-mcp-release.mjs')
    expect(probe).toContain("await bulkPut('nodes', nodes)")
    expect(probe).toContain("await bulkPut('edges', edges)")
    expect(probe).toContain('data-canvas-hydrated="true"')
    expect(probe).toContain("request('tools/call'")
    expect(probe).toContain("name: 'readGraph'")
    expect(probe).toContain("result?.nodes?.length !== 2")
    expect(probe).toContain("result?.edges?.length !== 1")
    expect(probe).toContain("'deleteNodes', 'runNode', 'rememberMemory'")
    expect(probe).toContain('protected MCP requests changed the graph')
    expect(probe).toContain('protectedToolsDenied: denied')
  })

  it('is registered as a release validation command', () => {
    const pkg = JSON.parse(read('../package.json'))
    const release = JSON.parse(read('../.codex/project-release.json'))
    expect(pkg.scripts['verify:mcp:release']).toBe('node scripts/run-canvas-mcp-release.mjs')
    expect(release.validation.commands).toContain('npm run verify:mcp:release')
    expect(release.validation.commands).toContain('npm run verify:storage:release')
    expect(release.validation.commands).toContain('npm run verify:cli:release')
  })
})
