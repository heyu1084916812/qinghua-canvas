import type { ComponentProps } from 'react'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import { AgentComposerPane } from './AgentComposerPane'
import { AgentConversationPane } from './AgentConversationPane'
import { AgentPanelHeader } from './AgentPanelHeader'
import styles from './AgentPanel.module.css'

export interface AgentPanelViewProps {
  current: AgentSession | null
  openPicker: string | null
  headerProps: ComponentProps<typeof AgentPanelHeader>
  conversationProps: ComponentProps<typeof AgentConversationPane>
  composerProps: ComponentProps<typeof AgentComposerPane>
  onDismissPicker: () => void
  onDropFiles: (files: FileList | null) => void
}

/**
 * Agent 面板的纯渲染壳。
 *
 * 业务状态、Controller、Store 和工具执行都由 AgentPanel 装配；这里只保持原有
 * DOM、属性与事件顺序，把三个视图壳组合成同一块面板。
 */
export function AgentPanelView({
  current,
  openPicker,
  headerProps,
  conversationProps,
  composerProps,
  onDismissPicker,
  onDropFiles,
}: AgentPanelViewProps) {
  return (
    <aside
      className={styles.panel}
      data-agent-panel
      data-agent-session-id={current?.id}
      /**
       * Esc 先关参数浮层：输入框里的 Esc 不应把整块面板收起来。
       */
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !openPicker) return
        event.preventDefault()
        onDismissPicker()
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault()
        onDropFiles(event.dataTransfer?.files ?? null)
      }}
    >
      <AgentPanelHeader {...headerProps} />
      <AgentConversationPane {...conversationProps} />
      <AgentComposerPane {...composerProps} />
    </aside>
  )
}
