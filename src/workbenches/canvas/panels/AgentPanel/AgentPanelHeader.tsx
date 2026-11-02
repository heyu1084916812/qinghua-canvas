import type { AgentSession } from '../../../../state/agent/sessionStore'
import {
  IconCheck,
  IconClose,
  IconDelete,
  IconPlus,
  IconRename,
  IconSettings,
} from '../../toolbar/icons'
import { ParamPicker } from '../ParamPicker'
import styles from './AgentPanel.module.css'

export interface AgentPanelHeaderProps {
  sessions: readonly AgentSession[]
  current: AgentSession | null
  renaming: boolean
  titleDraft: string
  pickerOpen: boolean
  confirmDelete: boolean
  onTitleDraftChange(value: string): void
  onCommitRename(): void
  onCancelRename(): void
  onToggleSessionPicker(): void
  onClosePicker(): void
  onSwitchSession(session: AgentSession): void
  onNewSession(): void
  onStartRename(): void
  onDeleteSession(): void
  onOpenSettings(): void
  onClose(): void
}

/**
 * Agent 面板头部只负责会话切换与生命周期动作。
 *
 * 会话存储、运行态和删除语义留在 AgentPanel；这里不能自行修改会话。
 */
export function AgentPanelHeader({
  sessions,
  current,
  renaming,
  titleDraft,
  pickerOpen,
  confirmDelete,
  onTitleDraftChange,
  onCommitRename,
  onCancelRename,
  onToggleSessionPicker,
  onClosePicker,
  onSwitchSession,
  onNewSession,
  onStartRename,
  onDeleteSession,
  onOpenSettings,
  onClose,
}: AgentPanelHeaderProps) {
  return (
    <header className={styles.head} data-agent-header>
      {renaming ? (
        <>
          <input
            className={styles.titleInput}
            value={titleDraft}
            autoFocus
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => onTitleDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onCommitRename()
              if (event.key === 'Escape') onCancelRename()
            }}
            data-agent-title-input
          />
          <button
            type="button"
            className={styles.iconBtn}
            onClick={onCommitRename}
            title="保存名字"
            data-agent-rename-save
          >
            <IconCheck size={16} />
          </button>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={onCancelRename}
            title="放弃改名"
            data-agent-rename-cancel
          >
            <IconClose size={16} />
          </button>
        </>
      ) : (
        <>
          <span
            className={styles.sessionPick}
            data-agent-session-count={sessions.length}
          >
            <ParamPicker
              name="agent-session"
              ariaLabel={`切换对话（共 ${sessions.length} 条）`}
              label={current?.title ?? '新对话'}
              size="compact"
              closeOnSelect
              sections={[
                {
                  name: 'session',
                  label: '对话',
                  variant: 'list',
                  maxRows: 8,
                  options: sessions.map((session) => ({
                    value: session.id,
                    label: session.title,
                  })),
                  value: current?.id ?? '',
                  onSelect: (id) => {
                    const hit = sessions.find((session) => session.id === id)
                    if (hit) onSwitchSession(hit)
                  },
                },
              ]}
              open={pickerOpen}
              onToggle={onToggleSessionPicker}
              onClose={onClosePicker}
            />
          </span>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={onNewSession}
            title="新建对话"
            data-agent-new
          >
            <IconPlus size={16} />
          </button>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={onStartRename}
            disabled={!current}
            title="给这条对话改名"
            data-agent-rename
          >
            <IconRename size={16} />
          </button>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={onDeleteSession}
            disabled={!current}
            title={confirmDelete ? '再点一次就删掉' : '删除这条对话'}
            data-agent-delete
          >
            {confirmDelete ? (
              <span className={styles.confirmText}>确认删除</span>
            ) : (
              <IconDelete size={16} />
            )}
          </button>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={onOpenSettings}
            title="Agent 设置"
            aria-label="打开 Agent 设置"
            data-agent-settings
          >
            <IconSettings size={16} />
          </button>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={onClose}
            title="收起 Agent 面板"
            data-agent-close
          >
            <IconClose size={16} />
          </button>
        </>
      )}
    </header>
  )
}
