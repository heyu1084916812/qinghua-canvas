import type { MutableRefObject } from 'react'
import { IconDelete, IconEdit } from '../../../app/SettingsIcons'
import { channelMenuArrowFocus } from '../settingsPageOverlayRules'
import { settingsPageStyles as styles } from './settingsPageStyles'

export type SettingsChannelContextMenuViewProps = {
  menuRef: MutableRefObject<HTMLDivElement | null>
  channelId: string
  channelName: string
  builtin: boolean
  confirmDelete: boolean
  busy: boolean
  left: number
  top: number
  width: number
  onEdit: (channelId: string) => void
  onRequestDelete: () => void
  onConfirmDelete: (channelId: string) => void
  onCancelDelete: () => void
}

export function SettingsChannelContextMenuView({
  menuRef,
  channelId,
  channelName,
  builtin,
  confirmDelete,
  busy,
  left,
  top,
  width,
  onEdit,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
}: SettingsChannelContextMenuViewProps) {
  return (
    <div
      ref={menuRef}
      className={styles.channelContextMenu}
      data-channel-context-menu={channelId}
      role="menu"
      aria-label={`${channelName} 操作`}
      style={{ left, top, width }}
      onKeyDown={channelMenuArrowFocus}
    >
      {confirmDelete ? (
        <>
          <p className={styles.channelMenuConfirmText}>
            删除「{channelName}」？不可撤销
          </p>
          <button
            type="button"
            className={`${styles.channelMenuItem} ${styles.channelMenuItemDanger}`}
            role="menuitem"
            data-channel-menu-delete-confirm={channelId}
            disabled={busy}
            onClick={() => onConfirmDelete(channelId)}
          >
            <IconDelete size={16} />
            确认删除
          </button>
          <button
            type="button"
            className={styles.channelMenuItem}
            role="menuitem"
            data-channel-menu-delete-cancel
            onClick={onCancelDelete}
          >
            取消
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            className={styles.channelMenuItem}
            role="menuitem"
            data-channel-menu-edit={channelId}
            onClick={() => onEdit(channelId)}
          >
            <IconEdit size={16} />
            编辑
          </button>
          {!builtin ? (
            <button
              type="button"
              className={`${styles.channelMenuItem} ${styles.channelMenuItemDanger}`}
              role="menuitem"
              data-channel-menu-delete={channelId}
              onClick={onRequestDelete}
            >
              <IconDelete size={16} />
              删除
            </button>
          ) : null}
        </>
      )}
    </div>
  )
}
