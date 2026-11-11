import { useSyncExternalStore } from 'react'
import {
  getAgentWebResearch,
  setAgentWebResearch,
  subscribeAgentWebResearch,
} from '../../../../state/ui/agentWebResearch'
import { IconGlobe } from '../../toolbar/icons'
import styles from './AgentWebResearchToggle.module.css'

/**
 * Agent 输入框里的「联网」开关（用户 2026-11-11）。
 *
 * 全局一份，持久化由 `useAgentWebResearchPersistence` 负责。关闭后本轮不向模型暴露
 * researchDesign / readPage，系统提示词同步说明“联网已关闭”。
 */
export function AgentWebResearchToggle() {
  const enabled = useSyncExternalStore(
    subscribeAgentWebResearch,
    getAgentWebResearch,
    getAgentWebResearch,
  )
  return (
    <button
      type="button"
      className={`${styles.toggle} ${enabled ? styles.on : ''}`}
      aria-pressed={enabled}
      title={
        enabled
          ? '联网已开启：Agent 可以搜索网页和读取链接（Tavily Key 在 设置 → Agent → 工具 → 联网调研）'
          : '联网已关闭：Agent 不会搜索或读取网页'
      }
      data-agent-web-toggle={enabled ? 'on' : 'off'}
      onClick={() => setAgentWebResearch(!enabled)}
    >
      <IconGlobe size={14} />
      <span>联网</span>
    </button>
  )
}
