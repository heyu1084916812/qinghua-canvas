import { useSyncExternalStore } from 'react'
import {
  getAgentHostRenderer,
  getAgentHosts,
  subscribeAgentHosts,
} from './AgentHostRegistry'

/**
 * 常驻宿主出口。
 *
 * 非活动记录只切 `display:none`，不卸载 renderer；因此工作台内部的面板、
 * AbortController、队列与确认状态可以穿过路由切换继续存活。
 */
export function AgentHostOutlet() {
  const hosts = useSyncExternalStore(
    subscribeAgentHosts,
    getAgentHosts,
    getAgentHosts,
  )

  return (
    <>
      {hosts.map((host) => {
        const Renderer = getAgentHostRenderer(host.kind)
        if (!Renderer) return null
        return (
          <div
            key={host.id}
            data-agent-host-record={host.id}
            data-agent-host-kind={host.kind}
            data-agent-host-active={host.active ? 'true' : 'false'}
            style={{ display: host.active ? 'contents' : 'none' }}
          >
            <Renderer host={host} />
          </div>
        )
      })}
    </>
  )
}
