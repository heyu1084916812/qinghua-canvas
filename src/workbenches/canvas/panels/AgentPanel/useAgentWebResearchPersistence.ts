import { useEffect } from 'react'
import {
  getAgentWebResearch,
  setAgentWebResearch,
  subscribeAgentWebResearch,
} from '../../../../state/ui/agentWebResearch'

export interface AgentWebResearchPresets {
  loadAgentWebResearch(): Promise<boolean>
  saveAgentWebResearch(enabled: boolean): Promise<void>
}

/**
 * 「联网」开关的持久化：挂载时读回上次选择，之后用户每次切换都写回 presets。
 * 读回本身不触发写入（避免启动时把默认值覆盖掉用户的选择）。
 */
export function bindAgentWebResearchPersistence(presets: AgentWebResearchPresets): () => void {
  let alive = true
  let loading = true
  const unsubscribe = subscribeAgentWebResearch(() => {
    if (loading) return
    void presets.saveAgentWebResearch(getAgentWebResearch())
  })
  void presets
    .loadAgentWebResearch()
    .then((saved) => {
      if (alive) setAgentWebResearch(saved)
    })
    .catch(() => {
      // 读取失败沿用默认开启。
    })
    .finally(() => {
      loading = false
    })
  return () => {
    alive = false
    unsubscribe()
  }
}

export function useAgentWebResearchPersistence(presets: AgentWebResearchPresets): void {
  useEffect(() => bindAgentWebResearchPersistence(presets), [presets])
}
