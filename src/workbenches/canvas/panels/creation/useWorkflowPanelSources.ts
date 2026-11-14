import { useContext, useEffect, useState } from 'react'
import { ChannelStoreContext } from '../../../../app/providers/ChannelStoreProvider'
import { usePlatformOptional } from '../../../../app/providers/PlatformProvider'
import { createWorkflowEntryStore } from '../../../../state/channel/workflowEntryStore'
import type { WorkflowEntry } from '../../../../domain/project/workflowParams'
import type { WorkflowPanelSources } from './workflowPanelSources'

/**
 * 组装创作面板的「工作流来源」：RunningHub 渠道清单 + 每个渠道的条目。
 *
 * 订阅渠道店（启用/新增时刷新），条目从 `presets` 读（与设置页同一行）。
 * 没有 Provider（单测 / 旁路渲染）时返回 null —— 面板照常按 API 模式渲染。
 */
export function useWorkflowPanelSources(): WorkflowPanelSources | null {
  const channels = useContext(ChannelStoreContext)
  const platform = usePlatformOptional()
  const [entriesByChannel, setEntriesByChannel] = useState<Record<string, WorkflowEntry[]>>({})
  const [tick, setTick] = useState(0)

  useEffect(
    () => (channels ? channels.subscribe(() => setTick((value) => value + 1)) : undefined),
    [channels],
  )

  const channelList = channels ? channels.getState().channels : []
  const rhChannels = channelList.filter((channel) => channel.protocol === 'runninghub-api')
  const key = rhChannels.map((channel) => channel.id).join(',') + `|${tick}`

  useEffect(() => {
    if (!platform) return
    let alive = true
    const store = createWorkflowEntryStore(platform.storage)
    const ids = key ? key.split(',') : []
    void Promise.all(ids.map(async (id) => [id, await store.load(id)] as const)).then((pairs) => {
      if (alive) setEntriesByChannel(Object.fromEntries(pairs))
    })
    return () => {
      alive = false
    }
  }, [key, platform?.storage])

  if (!channels || !platform) return null
  if (rhChannels.length === 0) return null
  return {
    channels: rhChannels.map((channel) => ({
      id: channel.id,
      name: channel.name,
      entries: entriesByChannel[channel.id] ?? [],
    })),
  }
}
