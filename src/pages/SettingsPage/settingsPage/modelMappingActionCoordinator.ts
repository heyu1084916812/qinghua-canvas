import type { ChannelStore } from '../../../state/channel/channelStore'

export interface ModelMappingNotice {
  id: string
  tone: 'ok' | 'error'
  text: string
}

export interface ModelMappingTestState {
  status: 'checking' | 'ok' | 'missing' | 'error'
  message: string
}

export interface ModelMappingPorts {
  channels: ChannelStore
  selectedId(): string | null
  activeGroupId(): string | undefined
  timers: Map<string, number>
  setMapDrafts(update: (previous: Record<string, string>) => Record<string, string>): void
  setMapSaveNotice(value: ModelMappingNotice | null): void
  setMapTests(update: (previous: Record<string, ModelMappingTestState>) => Record<string, ModelMappingTestState>): void
  setTimeout(handler: () => void, delay: number): number
  clearTimeout(timer: number): void
}

export type ModelMappingActions = ReturnType<typeof createModelMappingActions>

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

/** 模型映射草稿的 600ms 防抖、保存回执与映射测试，不持有 React 状态。 */
export function createModelMappingActions(ports: ModelMappingPorts) {
  const flush = async (logicalName: string, upstreamId: string): Promise<void> => {
    const selectedId = ports.selectedId()
    if (!selectedId) return
    const timer = ports.timers.get(logicalName)
    if (timer !== undefined) ports.clearTimeout(timer)
    ports.timers.delete(logicalName)
    try {
      await ports.channels.setModelMapping(selectedId, logicalName, upstreamId)
      ports.setMapDrafts((previous) => {
        if (previous[logicalName] !== upstreamId) return previous
        const next = { ...previous }
        delete next[logicalName]
        return next
      })
      ports.setMapSaveNotice({ id: logicalName, tone: 'ok', text: '已保存' })
    } catch (error) {
      ports.setMapSaveNotice({
        id: logicalName,
        tone: 'error',
        text: errorMessage(error, '保存失败'),
      })
    }
  }

  return {
    flush,
    schedule(logicalName: string, upstreamId: string): void {
      const previous = ports.timers.get(logicalName)
      if (previous !== undefined) ports.clearTimeout(previous)
      ports.setMapSaveNotice(null)
      const timer = ports.setTimeout(() => {
        void flush(logicalName, upstreamId)
      }, 600)
      ports.timers.set(logicalName, timer)
    },
    test: async (logicalName: string, upstreamId: string): Promise<void> => {
      const selectedId = ports.selectedId()
      if (!selectedId) return
      ports.setMapTests((previous) => ({
        ...previous,
        [logicalName]: { status: 'checking', message: '正在读取模型目录…' },
      }))
      try {
        await flush(logicalName, upstreamId)
        const result = await ports.channels.testModelMapping(
          selectedId,
          logicalName,
          upstreamId,
          ports.activeGroupId(),
        )
        ports.setMapTests((previous) => ({
          ...previous,
          [logicalName]: { status: result.status, message: result.message },
        }))
      } catch (error) {
        ports.setMapTests((previous) => ({
          ...previous,
          [logicalName]: {
            status: 'error',
            message: error instanceof Error ? error.message : String(error),
          },
        }))
      }
    },
  }
}
