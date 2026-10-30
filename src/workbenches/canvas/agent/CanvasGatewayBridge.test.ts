import { describe, expect, it, vi } from 'vitest'
import { handleCanvasGatewayTool } from './CanvasGatewayBridge'

function executor() {
  return {
    capabilities: vi.fn(() => ({ tools: [{ name: 'readGraph' }], denied: ['runNode'] })),
    read: vi.fn(async (tool: string) => ({ tool, nodes: 2 })),
    write: vi.fn(async (tool: string) => ({ tool, ok: true })),
  }
}

describe('CanvasGatewayBridge', () => {
  it('只开放选中的读画布和低风险写工具', async () => {
    const port = executor()
    expect(
      await handleCanvasGatewayTool(
        { tool: 'readGraph', arguments: { scope: 'all' } },
        port,
      ),
    ).toEqual({
      ok: true,
      result: { tool: 'readGraph', nodes: 2 },
    })
    expect(
      await handleCanvasGatewayTool(
        { tool: 'moveNodes', arguments: { ids: ['n1'], dx: 10 } },
        port,
      ),
    ).toEqual({
      ok: true,
      result: { tool: 'moveNodes', ok: true },
    })
    expect(port.read).toHaveBeenCalledTimes(1)
    expect(port.write).toHaveBeenCalledTimes(1)
  })

  it('删节点和付费生成必须留在应用内确认', async () => {
    const port = executor()
    for (const tool of ['deleteNodes', 'deleteEdges', 'runNode', 'runFrom']) {
      const response = await handleCanvasGatewayTool(
        { tool, arguments: {} },
        port,
      )
      expect(response.ok).toBe(false)
      expect(response.error).toContain('必须在应用内确认')
    }
    expect(port.read).not.toHaveBeenCalled()
    expect(port.write).not.toHaveBeenCalled()
  })

  it('能力清单由现有 AGENT_TOOLS 适配器返回，不另建第二套工具', async () => {
    const port = executor()
    expect(
      await handleCanvasGatewayTool(
        { tool: '__capabilities', arguments: {} },
        port,
      ),
    ).toEqual({
      ok: true,
      result: { tools: [{ name: 'readGraph' }], denied: ['runNode'] },
    })
    expect(port.capabilities).toHaveBeenCalledTimes(1)
  })

  it('工具自身返回 ok=false 时，网关和 MCP 也要得到失败结果', async () => {
    const port = {
      ...executor(),
      write: vi.fn(async () => ({
        ok: false,
        problems: ['节点不存在'],
      })),
    }
    await expect(
      handleCanvasGatewayTool(
        { tool: 'moveNodes', arguments: { nodeIds: ['missing'] } },
        port,
      ),
    ).resolves.toEqual({
      ok: false,
      result: { ok: false, problems: ['节点不存在'] },
      error: '节点不存在',
    })
  })
})
