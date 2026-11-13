import type { ReactNode } from 'react'
import { formatRelative } from '../../domain/shared/time'
import type { ProjectListItem } from '../../domain/project/project'
import type { WorkbenchId } from '../../domain/shared/workbench'
import type { IconSize } from '../../ui/icon'
import {
  IconCanvas,
  IconEcommerce,
  IconStoryboard,
} from '../AppSidebarIcons'
import {
  IconChevron,
  IconFolder,
  IconMore,
  IconPin,
} from '../ProjectTreeIcons'
import styles from '../ProjectTree.module.css'

export const PROJECT_ICON: Record<WorkbenchId, (props: { size?: IconSize }) => JSX.Element> = {
  canvas: IconCanvas,
  ecommerce: IconEcommerce,
  storyboard: IconStoryboard,
}

export function ProjectDeleteConfirmActions({
  deleting,
  onCancel,
  onConfirm,
}: {
  deleting: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <>
      <button
        type="button"
        disabled={deleting}
        onClick={onCancel}
      >
        取消
      </button>
      <button
        type="button"
        className={styles.dangerButton}
        disabled={deleting}
        data-project-tree-confirm-delete
        onClick={onConfirm}
      >
        {deleting ? '收尾中…' : '确认删除'}
      </button>
    </>
  )
}

export function WorkbenchIcon({ workbench, size = 'md' }: { workbench: WorkbenchId; size?: IconSize }) {
  const Icon = PROJECT_ICON[workbench]
  return <Icon size={size} />
}

export function GroupRow({
  label,
  count,
  pinned,
  collapsed,
  onToggle,
  onTogglePin,
  onMore,
}: {
  label: string
  count: number
  pinned: boolean
  collapsed: boolean
  onToggle: () => void
  onTogglePin?: () => void
  onMore?: (button: HTMLButtonElement) => void
}) {
  return (
    <div className={styles.groupRow} data-project-tree-group>
      <button
        type="button"
        className={styles.groupMain}
        aria-expanded={!collapsed}
        onClick={onToggle}
      >
        <span className={styles.groupIcon}>
          <IconFolder size={16} />
        </span>
        <span className={styles.groupLabel}>{label}</span>
        <span className={collapsed ? styles.chevron : `${styles.chevron} ${styles.chevronOpen}`}>
          <IconChevron size={13} />
        </span>
        <span className={styles.groupCount}>{count}</span>
      </button>
      {(onTogglePin || onMore) && (
        <div className={styles.rowActions}>
          {onTogglePin && (
            <button
              type="button"
              className={pinned ? `${styles.iconButton} ${styles.iconButtonOn}` : styles.iconButton}
              title={pinned ? '取消置顶' : '置顶'}
              aria-label={pinned ? '取消置顶' : '置顶'}
              onClick={onTogglePin}
            >
              <IconPin size={14} />
            </button>
          )}
          {onMore && (
            <button
              type="button"
              className={styles.iconButton}
              title="更多"
              aria-label="更多"
              onClick={(event) => onMore(event.currentTarget)}
            >
              <IconMore size={15} />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export function GroupExpandButton({
  count,
  expanded,
  groupId,
  onToggle,
}: {
  count: number
  expanded: boolean
  groupId: string
  onToggle: (groupId: string) => void
}) {
  return (
    <button
      type="button"
      className={styles.groupExpand}
      data-project-tree-expand={groupId}
      aria-expanded={expanded}
      onClick={() => onToggle(groupId)}
    >
      {expanded ? '收起' : `展开显示 (${count})`}
    </button>
  )
}

export function ProjectRow({
  project,
  active,
  onOpen,
  onTogglePin,
  onMore,
}: {
  project: ProjectListItem
  active: boolean
  onOpen: () => void
  onTogglePin: () => void
  onMore: (button: HTMLButtonElement) => void
}) {
  const Icon = PROJECT_ICON[project.workbench]
  return (
    <li
      className={active ? `${styles.projectRow} ${styles.projectRowActive}` : styles.projectRow}
      data-project-tree-item={project.id}
      data-project-tree-workbench={project.workbench}
      data-project-tree-active={active ? 'true' : 'false'}
    >
      <button
        type="button"
        className={styles.projectMain}
        onClick={onOpen}
        title={project.name}
        aria-current={active ? 'page' : undefined}
      >
        <span className={styles.projectIcon}>
          <Icon size="sm" />
        </span>
        <span className={styles.projectName}>{project.name}</span>
        <span className={styles.projectTime} title={new Date(project.updatedAt).toLocaleString('zh-CN')}>
          {formatRelative(project.updatedAt)}
        </span>
      </button>
      <div className={styles.rowActions}>
        <button
          type="button"
          className={
            project.pinnedAt
              ? `${styles.iconButton} ${styles.iconButtonOn}`
              : styles.iconButton
          }
          title={project.pinnedAt ? '取消置顶' : '置顶'}
          aria-label={project.pinnedAt ? '取消置顶' : '置顶'}
          onClick={onTogglePin}
        >
          <IconPin size={14} />
        </button>
        <button
          type="button"
          className={styles.iconButton}
          title="更多"
          aria-label="更多"
          onClick={(event) => onMore(event.currentTarget)}
        >
          <IconMore size={15} />
        </button>
      </div>
    </li>
  )
}

export function MenuButton({
  icon,
  label,
  trailing,
  danger = false,
  disabled = false,
  onClick,
}: {
  icon: ReactNode
  label: string
  trailing?: string
  danger?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      className={danger ? `${styles.menuItem} ${styles.menuItemDanger}` : styles.menuItem}
      onClick={onClick}
    >
      <span className={styles.menuIcon}>{icon}</span>
      <span className={styles.menuLabel}>{label}</span>
      {trailing && <span className={styles.menuTrailing}>{trailing}</span>}
    </button>
  )
}

export function ModalLayer({
  children,
  onClose,
}: {
  children: ReactNode
  onClose: () => void
}) {
  return (
    <div
      className={styles.modalLayer}
      onPointerDown={(event) => {
        if (event.currentTarget === event.target) onClose()
      }}
    >
      {children}
    </div>
  )
}
