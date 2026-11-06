import { describe, expect, it } from 'vitest'
import overlay from './GlobalSettingsOverlay.tsx?raw'
import routes from './routes.tsx?raw'
import canvasMcpPanel from '../features/settings/CanvasMcpPanel.tsx?raw'
import viteConfig from '../../vite.config.ts?raw'
import ciWorkflow from '../../.github/workflows/ci.yml?raw'

describe('delivery build boundaries', () => {
  it('loads HostingPage dynamically from both its route and the settings overlay', () => {
    expect(overlay).toContain("import('../pages/HostingPage/HostingPage')")
    expect(routes).toContain("import('../pages/HostingPage/HostingPage')")
    expect(overlay).not.toContain("import { HostingPage } from '../pages/HostingPage/HostingPage'")
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
    expect(canvasMcpPanel).toContain('mcpConfigText(info.mcpConfig)')
    expect(canvasMcpPanel).not.toContain('JSON.stringify(info)')
  })
})
