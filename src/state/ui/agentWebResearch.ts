/**
 * Agent「联网」开关的运行时状态（全局一份；持久化在 presets 的 `agent:web-research` 行）。
 *
 * 默认开启：没填 Tavily Key 时工具会如实提示去设置里填，而不是悄悄不搜。
 * 关闭后：本轮不向模型暴露 researchDesign / readPage，系统提示词说明联网已关，
 * 模型若仍调用，工具层直接返回「联网已关闭」。
 */
const DEFAULT_AGENT_WEB_RESEARCH = true

let current = DEFAULT_AGENT_WEB_RESEARCH
const listeners = new Set<() => void>()

export function getAgentWebResearch(): boolean {
  return current
}

export function setAgentWebResearch(value: unknown): void {
  const next = typeof value === 'boolean' ? value : DEFAULT_AGENT_WEB_RESEARCH
  if (next === current) return
  current = next
  for (const listener of listeners) listener()
}

export function subscribeAgentWebResearch(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function __resetAgentWebResearchForTest(): void {
  current = DEFAULT_AGENT_WEB_RESEARCH
  for (const listener of listeners) listener()
}
