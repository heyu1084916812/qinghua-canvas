import { createPortal } from 'react-dom'
import {
  queuedTurnPreview,
  type QueuedAgentTurn,
} from '../../../../domain/agent/queuedTurn'
import {
  IconCheck,
  IconDelete,
  IconMore,
  IconRename,
  IconSteer,
} from '../../toolbar/icons'
import {
  statusCanSteer,
  type AgentPanelStatus,
} from './AgentActivityViews'
import styles from './AgentQueuePanel.module.css'

export interface AgentQueueMenuPosition {
  right: number
  bottom: number
}

export function AgentQueuePanel({
  turns,
  status,
  menuId,
  menuPosition,
  editingId,
  editingTurn,
  editingText,
  onGuide,
  onRemove,
  onMenuIdChange,
  onMenuPositionChange,
  onBeginEdit,
  onCommitEdit,
  onEditingIdChange,
  onEditingTextChange,
  onResume,
}: {
  turns: readonly QueuedAgentTurn[]
  status: AgentPanelStatus
  menuId: string | null
  menuPosition: AgentQueueMenuPosition | null
  editingId: string | null
  editingTurn: QueuedAgentTurn | null
  editingText: string
  onGuide: (turn: QueuedAgentTurn) => void
  onRemove: (turnId: string) => void
  onMenuIdChange: (turnId: string | null) => void
  onMenuPositionChange: (position: AgentQueueMenuPosition | null) => void
  onBeginEdit: (turn: QueuedAgentTurn) => void
  onCommitEdit: () => void
  onEditingIdChange: (turnId: string | null) => void
  onEditingTextChange: (text: string) => void
  onResume: () => void
}) {
  if (turns.length === 0) return null

  return (
    <div
      className={styles.queue}
      data-agent-queue
      data-agent-queue-count={turns.length}
    >
      <div className={styles.queueList}>
        {turns.map((turn, index) => (
          <div key={turn.id} className={styles.queueItem} data-agent-queue-item={turn.id}>
            <span className={styles.queueIndex}>{index + 1}</span>
            <span className={styles.queueText}>{queuedTurnPreview(turn.text)}</span>
            <div className={styles.queueActions}>
              <button
                type="button"
                className={styles.queueSteer}
                onClick={() => onGuide(turn)}
                disabled={
                  !statusCanSteer(status) ||
                  (turn.pendingAssetIds?.length ?? 0) > 0
                }
                title={
                  (turn.pendingAssetIds?.length ?? 0) > 0
                    ? '带新素材的消息只能排队'
                    : statusCanSteer(status)
                      ? '直接引导当前任务'
                      : '当前没有可引导的任务'
                }
                aria-label="直接引导"
                data-agent-queue-steer
              >
                <IconSteer size={14} />
                <span>引导</span>
              </button>
              <button
                type="button"
                className={styles.queueAction}
                onClick={() => onRemove(turn.id)}
                title="删除消息"
                aria-label="删除消息"
                data-agent-queue-remove
              >
                <IconDelete size={14} />
              </button>
              <button
                type="button"
                className={styles.queueAction}
                onClick={(event) => {
                  if (menuId === turn.id) {
                    onMenuIdChange(null)
                    onMenuPositionChange(null)
                    return
                  }
                  const rect = event.currentTarget.getBoundingClientRect()
                  onMenuPositionChange({
                    right: Math.max(8, window.innerWidth - rect.right),
                    bottom: Math.max(8, window.innerHeight - rect.top + 6),
                  })
                  onMenuIdChange(turn.id)
                }}
                title="更多"
                aria-label="更多"
                aria-haspopup="menu"
                aria-expanded={menuId === turn.id}
                data-agent-queue-more={turn.id}
              >
                <IconMore size={15} />
              </button>
            </div>
            {menuId === turn.id &&
              menuPosition &&
              editingId !== turn.id &&
              createPortal(
                <div
                  className={styles.queueMenu}
                  role="menu"
                  data-agent-queue-menu={turn.id}
                  style={{
                    right: menuPosition.right,
                    bottom: menuPosition.bottom,
                  }}
                >
                  <button
                    type="button"
                    className={styles.queueMenuItem}
                    role="menuitem"
                    onClick={() => onBeginEdit(turn)}
                    data-agent-queue-edit
                  >
                    <IconRename size={14} />
                    编辑消息
                  </button>
                </div>,
                document.body,
              )}
          </div>
        ))}
      </div>
      {(status.kind === 'idle' || status.kind === 'error') && (
        <button
          type="button"
          className={styles.queueResume}
          onClick={onResume}
          data-agent-queue-resume
        >
          继续排队
        </button>
      )}
      {editingTurn && (
        <div className={styles.queueEditPopover}>
          <textarea
            className={styles.queueEditInput}
            value={editingText}
            rows={3}
            autoFocus
            aria-label="编辑排队消息"
            onChange={(event) => onEditingTextChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                onEditingIdChange(null)
                onEditingTextChange('')
              }
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault()
                onCommitEdit()
              }
            }}
            data-agent-queue-edit-input
          />
          <div className={styles.queueEditActions}>
            <button
              type="button"
              className={styles.queueEditSave}
              onClick={onCommitEdit}
              disabled={!editingText.trim()}
              data-agent-queue-edit-save
            >
              <IconCheck size={13} />
              保存
            </button>
            <button
              type="button"
              className={styles.queueEditCancel}
              onClick={() => {
                onEditingIdChange(null)
                onEditingTextChange('')
              }}
            >
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
