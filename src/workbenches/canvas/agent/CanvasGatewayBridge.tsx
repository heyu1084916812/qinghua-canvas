import { useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { ChannelStore } from '../../../state/channel/channelStore'
import type { CanvasStore } from '../../../state/workbenches/canvas/store'
import { detectRuntime } from '../../../platform'
import type { AgentNodeType } from '../../../domain/agent/plan'
import {
  channelIdForLogical,
  capabilityOfLogical,
} from '../../../domain/project/modelCatalog'
import { agentToolDefinitionOf } from '../../../domain/agent/toolRegistry'
import type { Rect } from '../../../domain/agent/landing'
import { resolveDefaults } from '../../../features/canvas/createNodeWithDefaults'
import {
  AGENT_TOOLS,
  executeConfirmedTool,
  executeReadTool,
  type AgentToolContext,
} from './tools'

const GATEWAY_TOOL_NAMES = [
  'readGraph',
  'readAsset',
  'readResult',
  'applyPlan',
  'moveNodes',
  'arrangeNodes',
] as const
type GatewayToolName = (typeof GATEWAY_TOOL_NAMES)[number]

const READ_GATEWAY_TOOLS = new Set<GatewayToolName>(['readGraph', 'readAsset', 'readResult'])

export interface CanvasGatewayRequest {
  requestId: string
  tool: string
  arguments: unknown
}

export interface CanvasGatewayExecutor {
  capabilities: () => unknown
  read: (tool: string, args: unknown) => Promise<unknown>
  write: (tool: string, args: unknown) => Promise<unknown>
}

export async function handleCanvasGatewayTool(
  request: Pick<CanvasGatewayRequest, 'tool' | 'arguments'>,
  executor: CanvasGatewayExecutor,
): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  if (request.tool === '__capabilities') {
    return { ok: true, result: executor.capabilities() }
  }
  if (!(GATEWAY_TOOL_NAMES as readonly string[]).includes(request.tool)) {
    return {
      ok: false,
      error: `工具 ${request.tool} 未开放给外部 Canvas MCP；删改和付费生成必须在应用内确认。`,
    }
  }
  const tool = request.tool as GatewayToolName
  try {
    const result = READ_GATEWAY_TOOLS.has(tool)
      ? await executor.read(tool, request.arguments)
      : await executor.write(tool, request.arguments)
    if (
      result &&
      typeof result === 'object' &&
      (result as { ok?: unknown }).ok === false
    ) {
      const raw = result as { error?: unknown; reason?: unknown; problems?: unknown }
      const problems = Array.isArray(raw.problems)
        ? raw.problems.filter((item): item is string => typeof item === 'string')
        : []
      return {
        ok: false,
        result,
        error:
          problems.join('；') ||
          (typeof raw.reason === 'string' ? raw.reason : '') ||
          (typeof raw.error === 'string' ? raw.error : 'Canvas 工具执行失败'),
      }
    }
    return { ok: true, result }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function viewportWorldOf(viewport: { x: number; y: number; zoom: number }): Rect {
  const surface = document.querySelector<HTMLElement>('[data-canvas-surface]')
  const rect = surface?.getBoundingClientRect()
  const width = rect?.width ?? window.innerWidth
  const height = rect?.height ?? window.innerHeight
  return {
    x: viewport.x,
    y: viewport.y,
    w: width / Math.max(0.01, viewport.zoom),
    h: height / Math.max(0.01, viewport.zoom),
  }
}

export function CanvasGatewayBridge({
  store,
  channels,
}: {
  store: CanvasStore
  channels: ChannelStore
}) {
  useEffect(() => {
    if (detectRuntime() !== 'desktop') return
    let disposed = false
    let queue = Promise.resolve()
    const unlisten = listen<CanvasGatewayRequest>('canvas-gateway-request', (event) => {
      const run = async () => {
        const payload = event.payload
        const world = viewportWorldOf(store.getViewport())
        const selectedModelOf = (kind: 'image' | 'video'): string => {
          const allChannels = channels.getState().channels
          for (const id of store.getSelection()) {
            const node = store.getSnapshot().nodes.find((item) => item.id === id)
            const model =
              typeof (node?.data as { model?: unknown } | undefined)?.model === 'string'
                ? String((node?.data as { model?: string }).model).trim()
                : ''
            if (!model) continue
            const category =
              capabilityOfLogical(allChannels, model)?.category
            if (kind === 'video' ? category === 'video' : category !== 'video') return model
          }
          return ''
        }
        const ctx: AgentToolContext = {
          store,
          origin: { x: world.x + world.w / 2, y: world.y + world.h / 2 },
          viewportWorld: world,
          selectedIds: () => store.getSelection(),
          selectedModelOf,
          defaultsForNewNode: async (types) => {
            const out: Partial<Record<AgentNodeType, Record<string, unknown>>> = {}
            for (const type of types) {
              out[type] = await resolveDefaults({ channels, type })
            }
            return out
          },
          recipeForGenerated: (type, node) => {
            if (type !== 'generation') return undefined
            const kind = node.data.mode === 'video' ? 'video' : 'image'
            const planned =
              typeof node.data.model === 'string' ? node.data.model.trim() : ''
            const model = planned || selectedModelOf(kind)
            if (!model) return undefined
            const channelId = channelIdForLogical(channels.enabledChannels(), model)
            return channelId ? { channelId, model } : undefined
          },
          channelIdForModel: (model) =>
            channelIdForLogical(channels.enabledChannels(), model),
          categoryOfModel: (model) => {
            const allChannels = channels.getState().channels
            const category =
              capabilityOfLogical(allChannels, model)?.category
            return category === 'image' || category === 'video' || category === 'chat'
              ? category
              : undefined
          },
          runNodes: async () => {
            throw new Error('外部 MCP 不能直接触发付费生成')
          },
        }
        const response = await handleCanvasGatewayTool(
          { tool: payload.tool, arguments: payload.arguments },
          {
            capabilities: () => ({
              protocolVersion: 1,
              canvasOpen: true,
              tools: AGENT_TOOLS.filter((tool) =>
                (GATEWAY_TOOL_NAMES as readonly string[]).includes(tool.name),
              ).map((tool) => ({
                ...tool,
                access: agentToolDefinitionOf(tool.name)?.access ?? 'read',
                sideEffect: agentToolDefinitionOf(tool.name)?.sideEffect ?? 'none',
              })),
              denied: [
                'deleteNodes',
                'deleteEdges',
                'updateNode',
                'runNode',
                'runFrom',
                'rememberMemory',
              ],
            }),
            read: (tool, args) => executeReadTool(tool, args, ctx),
            write: (tool, args) => executeConfirmedTool(tool, args, ctx),
          },
        )
        if (disposed) return
        await invoke('canvas_gateway_respond', {
          requestId: payload.requestId,
          result: response,
        }).catch((error) => {
          console.error('[canvas-gateway] 回写结果失败', error)
        })
      }
      if (
        event.payload.tool === '__capabilities' ||
        READ_GATEWAY_TOOLS.has(event.payload.tool as GatewayToolName)
      ) {
        void run()
      } else {
        queue = queue.then(run, run)
      }
    })
    return () => {
      disposed = true
      void unlisten.then((off) => off()).catch((error) => {
        console.error('[canvas-gateway] 移除事件监听失败', error)
      })
    }
  }, [channels, store])

  return null
}
