import type { ClipperExtensionStatus } from './useClipperExtensionUpdate'
import styles from './ClipperExtensionUpdateNotice.module.css'

export function ClipperExtensionUpdateNotice({
  status,
  updating,
  message,
  onUpdate,
}: {
  status: ClipperExtensionStatus | null
  updating: boolean
  message: string
  onUpdate: () => Promise<void>
}) {
  if (!status?.needsUpdate && !status?.reloadRequired) return null
  return (
    <div className={styles.notice} data-clipper-extension-update>
      <div className={styles.copy}>
        <strong>轻画 Clipper 可更新</strong>
        <span>
          {`${status.loadedVersion ? '已加载' : '稳定目录'} ${
            status.loadedVersion ?? status.stableVersion ?? '未知'
          }，应用内置 ${status.bundledVersion ?? '未知'}`}
        </span>
      </div>
      <button
        type="button"
        className={styles.action}
        data-clipper-extension-update-action
        disabled={updating}
        onClick={() => void onUpdate()}
      >
        {updating ? '正在更新…' : message ? '重新打开扩展页' : '更新插件'}
      </button>
      {message ? (
        <p className={styles.message} role="status" aria-live="polite">
          {message}
        </p>
      ) : null}
    </div>
  )
}
