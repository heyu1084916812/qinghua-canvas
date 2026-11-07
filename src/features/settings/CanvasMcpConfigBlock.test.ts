import TestRenderer, { act } from 'react-test-renderer'
import { createElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { CanvasMcpConfigBlock } from './CanvasMcpConfigBlock'

const config = {
  mcpServers: {
    'qinghua-canvas': {
      command: 'powershell.exe',
      args: ['-NoProfile', '-File', 'canvas-mcp.ps1'],
    },
  },
}

describe('CanvasMcpConfigBlock', () => {
  it('switches between generic JSON and Codex TOML without exposing a token', () => {
    const copy = vi.fn()
    let renderer: TestRenderer.ReactTestRenderer
    act(() => {
      renderer = TestRenderer.create(
        createElement(CanvasMcpConfigBlock, { config, copy }),
      )
    })
    const buttons = () => renderer!.root.findAllByType('button')
    const text = () => renderer!.toJSON() && JSON.stringify(renderer!.toJSON())
    expect(text()).toContain('mcpServers')
    act(() => buttons()[2]!.props.onClick())
    expect(copy).toHaveBeenCalledWith(JSON.stringify(config, null, 2))
    act(() => buttons()[1]!.props.onClick())
    expect(text()).toContain('[mcp_servers.qinghua-canvas]')
    expect(text()).not.toContain('Bearer')
    expect(text()).not.toContain('token')
  })
})
