import { describe, expect, it } from 'vitest'
import overlay from './GlobalSettingsOverlay.tsx?raw'
import routes from './routes.tsx?raw'
import canvasMcpPanel from '../features/settings/CanvasMcpPanel.tsx?raw'
import canvasMcpBlock from '../features/settings/CanvasMcpConfigBlock.tsx?raw'
import canvasMcpConfig from '../features/settings/canvasMcpConfig.ts?raw'
import viteConfig from '../../vite.config.ts?raw'
import ciWorkflow from '../../.github/workflows/ci.yml?raw'

describe('delivery build boundaries', () => {
  it('loads HostingPage dynamically from both its route and the settings overlay', () => {
    const boundary = "import('../pages/HostingPage/HostingPage').then((m) => ({ default: m.HostingPage }))"
    expect(overlay).toContain(boundary)
    expect(routes).toContain(boundary)
    expect(overlay.match(/import\('\.\.\/pages\/HostingPage\/HostingPage'\)/g)?.length).toBe(1)
    expect(routes.match(/import\('\.\.\/pages\/HostingPage\/HostingPage'\)/g)?.length).toBe(1)
    expect(overlay).not.toContain("import { HostingPage } from '../pages/HostingPage/HostingPage'")
    expect(routes).not.toContain("import { HostingPage } from '../pages/HostingPage/HostingPage'")
  })

  it('keeps explicit stable chunk boundaries', () => {
    for (const name of ['react-vendor', 'xyflow', 'channel-adapters']) {
      expect(viteConfig).toContain(`name: '${name}'`)
    }
    expect(viteConfig).toContain('codeSplitting:')
  })

  it('runs delivery checks without publishing', () => {
    for (const command of ['npm ci', 'npm test', 'npm run check', 'npm run build']) {
      expect(ciWorkflow).toContain(`run: ${command}`)
    }
    expect(ciWorkflow).toContain('run: node scripts/check-versions.mjs')
    expect(ciWorkflow).not.toMatch(/run:\s*git\s+(?:push|tag)/)
  })

  it('copies the packaged Canvas MCP config without embedding the gateway token', () => {
    expect(canvasMcpPanel).toContain('<CanvasMcpConfigBlock')
    expect(canvasMcpBlock).toContain('codexMcpConfigText(config)')
    expect(canvasMcpBlock).toContain('data-canvas-mcp-format="codex"')
    expect(canvasMcpConfig).not.toContain('token')
    expect(canvasMcpPanel).not.toContain('JSON.stringify(info)')
  })
})
