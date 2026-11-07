import { describe, expect, it } from 'vitest'
import { codexMcpConfigText } from './canvasMcpConfig'

describe('Canvas MCP harness config', () => {
  it('turns a stdio MCP JSON entry into Codex TOML without exposing a token', () => {
    expect(codexMcpConfigText({
      mcpServers: {
        'qinghua-canvas': {
          command: 'powershell.exe',
          args: ['-NoProfile', '-File', 'C:\\轻画\\canvas-mcp.ps1', '-Dev'],
        },
      },
    })).toBe([
      '[mcp_servers.qinghua-canvas]',
      'command = "powershell.exe"',
      'args = ["-NoProfile", "-File", "C:\\\\轻画\\\\canvas-mcp.ps1", "-Dev"]',
    ].join('\n'))
  })

  it('returns an empty string for a config without a stdio command', () => {
    expect(codexMcpConfigText({ mcpServers: { bad: { url: 'http://127.0.0.1' } } })).toBe('')
    expect(codexMcpConfigText(null)).toBe('')
  })
})
