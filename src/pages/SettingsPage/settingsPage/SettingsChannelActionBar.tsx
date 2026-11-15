import styles from '../SettingsChannelForm.module.css'

/**
 * 渠道页底部的「删除 / 保存」条（参考图一最下面那一行）。
 *
 * 我们原来的保存是**改动即时落库**（失焦就存），底部这条只是给用户一个明确的
 * 「我改完了」的落点，同时把删除从右键菜单搬到一眼能看到的位置 —— 页面从此有头有尾。
 */
export function SettingsChannelActionBar({
  busy,
  canDelete,
  onSave,
  onDelete,
}: {
  busy: boolean
  canDelete: boolean
  onSave: () => void
  onDelete: () => void
}) {
  return (
    <div className={styles.formActions} data-settings-actions-bar>
      <button type="button" className={styles.danger} disabled={busy || !canDelete} onClick={onDelete} data-settings-delete>
        删除
      </button>
      <button type="button" disabled={busy} onClick={onSave} data-settings-save>
        保存
      </button>
    </div>
  )
}
