import { useState, useSyncExternalStore } from 'react'
import {
  getProjectRuntimePendingSnapshot,
  retryProjectRuntimeOperation,
  subscribeProjectRuntimePending,
  type ProjectRuntimePendingOperation,
} from './ProjectRuntimeRegistry'
import styles from './ProjectRuntimeRecoveryNotice.module.css'

function titleOf(operation: ProjectRuntimePendingOperation): string {
  if (operation.status === 'cleanup_failed') {
    return operation.workCommitted
      ? '项目已删除，运行态待清理'
      : '运行态待清理'
  }
  if (operation.status === 'recovery_failed') {
    return '项目操作未提交，运行态待恢复'
  }
  return '正在恢复项目运行态'
}

export function ProjectRuntimeRecoveryNotice() {
  const pending = useSyncExternalStore(
    subscribeProjectRuntimePending,
    getProjectRuntimePendingSnapshot,
    getProjectRuntimePendingSnapshot,
  )
  const [retrying, setRetrying] = useState<number | null>(null)

  if (pending.length === 0) return null

  const retry = async (operation: ProjectRuntimePendingOperation) => {
    if (retrying !== null || !operation.retryable) return
    setRetrying(operation.id)
    try {
      await retryProjectRuntimeOperation(operation.id)
    } catch {
      // Registry keeps the pending snapshot and refreshed reason.
    } finally {
      setRetrying(null)
    }
  }

  return (
    <aside
      className={styles.notice}
      data-project-runtime-recovery-notice
      role="status"
      aria-live="polite"
    >
      <div className={styles.heading}>运行态恢复</div>
      <div className={styles.list}>
        {pending.map((operation) => (
          <div
            key={operation.id}
            className={styles.row}
            data-project-runtime-pending={operation.id}
            data-project-runtime-work-committed={
              operation.workCommitted ? 'true' : 'false'
            }
          >
            <div className={styles.copy}>
              <strong>{titleOf(operation)}</strong>
              <span title={operation.reason}>
                {operation.projectIds.length} 个项目
              </span>
            </div>
            <button
              type="button"
              className={styles.retry}
              data-project-runtime-retry={operation.id}
              disabled={!operation.retryable || retrying !== null}
              onClick={() => void retry(operation)}
            >
              {!operation.retryable
                ? '恢复中…'
                : retrying === operation.id
                  ? '重试中…'
                  : '重试恢复'}
            </button>
          </div>
        ))}
      </div>
    </aside>
  )
}
