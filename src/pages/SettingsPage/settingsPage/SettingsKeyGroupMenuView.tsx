import type { MutableRefObject } from 'react'
import { IconDelete, IconEdit } from '../../../app/SettingsIcons'
import { settingsPageStyles as styles } from './settingsPageStyles'

export type SettingsKeyGroupMenuViewProps = {
  menuRef: MutableRefObject<HTMLDivElement | null>
  name: string
  left: number
  top: number
  confirm: boolean
  busy: boolean
  canDelete: boolean
  onEdit: () => void
  onRequestDelete: () => void
  onConfirmDelete: () => void
  onCancelDelete: () => void
}

export const KEY_GROUP_MENU_WIDTH = 176

export function SettingsKeyGroupMenuView({
  menuRef,
  name,
  left,
  top,
  confirm,
  busy,
  canDelete,
  onEdit,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
}: SettingsKeyGroupMenuViewProps) {
  return (
    <div
      ref={menuRef}
      className={styles.channelContextMenu}
      role="menu"
      aria-label={`${name} 分组操作`}
      data-key-group-menu
      style={{ left, top, width: KEY_GROUP_MENU_WIDTH }}
    >
      {confirm ? (
        <>
          <p className={styles.channelMenuConfirmText}>删除「{name}」？该组 Key 一并删除</p>
          <button
            type="button"
            role="menuitem"
            className={`${styles.channelMenuItem} ${styles.channelMenuItemDanger}`}
            data-key-group-menu-delete-confirm
            disabled={busy}
            onClick={onConfirmDelete}
          >
            <IconDelete size="md" />
            确认删除
          </button>
          <button
            type="button"
            role="menuitem"
            className={styles.channelMenuItem}
            data-key-group-menu-delete-cancel
            onClick={onCancelDelete}
          >
            取消
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            role="menuitem"
            className={styles.channelMenuItem}
            data-key-group-menu-rename
            onClick={onEdit}
          >
            <IconEdit size="md" />
            编辑
          </button>
          <button
            type="button"
            role="menuitem"
            className={`${styles.channelMenuItem} ${styles.channelMenuItemDanger}`}
            data-key-group-menu-delete
            disabled={busy || !canDelete}
            onClick={onRequestDelete}
          >
            <IconDelete size="md" />
            删除分组
          </button>
        </>
      )}
    </div>
  )
}
