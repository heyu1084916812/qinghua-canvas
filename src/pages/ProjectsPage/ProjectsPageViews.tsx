import { formatRelative } from '../../domain/shared/time'
import type { ProjectListItem } from '../../domain/project/project'
import { useAssetMeta } from '../../features/shared/assets/index'
import styles from './ProjectsPage.module.css'
import { projectCardMeta } from './projectListProjection'

/** 无项目时的空状态（产品文档 §5.6）。导出供 /_preview 陈列室做视觉回归 */
export function HomeEmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className={styles.empty}>
      <p className={styles.emptyTitle}>还没有项目</p>
      <p className={styles.emptyHint}>选择工作区后新建项目。</p>
      <button className={styles.newBtn} onClick={onCreate} data-new-project>
        ＋ 新建项目
      </button>
    </div>
  )
}

/**
 * 项目封面（用户 2026-09-27 第 2 条）：
 * 「用最后一张生成的图片作为封面，平铺展示，不要拉伸，占满显示项目卡片的显示区域即可」。
 */
function ProjectCover({ item }: { item: ProjectListItem }) {
  const meta = useAssetMeta(item.coverHash ?? undefined)

  if (!meta.url) {
    return <div className={styles.thumb} aria-hidden />
  }
  if (meta.mime?.startsWith('video/')) {
    return (
      <div className={styles.thumb}>
        <video className={styles.cover} src={meta.url} muted playsInline preload="metadata" />
      </div>
    )
  }
  return (
    <div className={styles.thumb}>
      <img className={styles.cover} src={meta.url} alt="" aria-hidden="true" draggable={false} />
    </div>
  )
}

/** 项目卡片（产品文档 §5.3）。导出供 /_preview 陈列室做视觉回归 */
export function ProjectCard(props: {
  project: ProjectListItem
  selecting: boolean
  selected: boolean
  confirming: boolean
  deleting: boolean
  menuOpen: boolean
  renaming: boolean
  renameValue: string
  onOpen: () => void
  onRenameChange: (v: string) => void
  onRenameCommit: () => void
  onCancelRename: () => void
  onRequestDelete: () => void
  onConfirmDelete: () => void
  onCancelDelete: () => void
  onToggleMenu: () => void
  onCloseMenu: () => void
  onStartRename: () => void
  onDuplicate: () => void
  onExport: () => void
  onExportWithAssets: () => void
}) {
  const {
    project, selecting, selected, confirming, deleting, menuOpen, renaming, renameValue,
    onOpen, onRenameChange, onRenameCommit, onCancelRename,
    onRequestDelete, onConfirmDelete, onCancelDelete,
    onToggleMenu, onStartRename, onDuplicate, onExport, onExportWithAssets,
  } = props
  const name = selecting && selected ? `${project.name}，已选择` : project.name

  return (
    <div
      className={`${styles.card} ${selected ? styles.cardSelected : ''}`}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      aria-pressed={selecting ? selected : undefined}
      data-selecting={selecting ? 'true' : undefined}
      data-selected={selected ? 'true' : undefined}
      data-project-card={project.id}
      data-project-workbench={project.workbench}
      aria-label={name}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
    >
      <ProjectCover item={project} />
      {selecting && (
        <span
          className={`${styles.selectMark} ${selected ? styles.selectMarkOn : ''}`}
          data-project-select-mark
          aria-hidden
        >
          {selected && <IconCheck />}
        </span>
      )}

      <div className={styles.cardBody}>
        {renaming ? (
          <input
            className={styles.renameInput}
            value={renameValue}
            autoFocus
            onChange={(e) => onRenameChange(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onBlur={onRenameCommit}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') e.stopPropagation()
              if (e.key === 'Enter') onRenameCommit()
              if (e.key === 'Escape') onCancelRename()
            }}
          />
        ) : (
          <div className={styles.cardName} data-project-name>
            {project.name}
          </div>
        )}
        <div className={styles.cardMeta} data-project-meta>
          {projectCardMeta(project, formatRelative(project.updatedAt))}
        </div>
      </div>

      <div className={styles.cardActions} onClick={(e) => e.stopPropagation()}>
        {confirming ? (
          <div className={styles.confirm}>
            <span className={styles.confirmText}>删除？</span>
            <button
              className={styles.confirmYes}
              data-project-card-confirm-delete
              disabled={deleting}
              onClick={onConfirmDelete}
            >
              {deleting ? '收尾中…' : '确认'}
            </button>
            <button
              className={styles.confirmNo}
              disabled={deleting}
              onClick={onCancelDelete}
            >
              取消
            </button>
          </div>
        ) : (
          <button
            className={styles.menuBtn}
            onClick={onToggleMenu}
            aria-label="项目菜单"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title="更多"
          >
            ⋯
          </button>
        )}

        {menuOpen && !confirming && (
          <div className={styles.menu} role="menu">
            <button
              className={styles.menuItem}
              role="menuitem"
              onClick={(e) => {
                e.stopPropagation()
                onStartRename()
              }}
            >
              重命名
            </button>
            <button
              className={styles.menuItem}
              role="menuitem"
              onClick={(e) => {
                e.stopPropagation()
                onDuplicate()
              }}
            >
              复制
            </button>
            <button
              className={`${styles.menuItem} ${styles.menuDanger}`}
              role="menuitem"
              onClick={(e) => {
                e.stopPropagation()
                onRequestDelete()
              }}
            >
              删除
            </button>
            <button
              className={styles.menuItem}
              role="menuitem"
              data-project-export
              onClick={(e) => {
                e.stopPropagation()
                onExport()
              }}
            >
              导出
            </button>
            <button
              className={styles.menuItem}
              role="menuitem"
              data-project-export-embed
              onClick={(e) => {
                e.stopPropagation()
                onExportWithAssets()
              }}
            >
              导出（含素材，体积大）
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/** 顶栏选择模式入口与批量栏复用的一组轻量图标 */
export function IconSelect({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="4" y="5" width="6" height="6" rx="1.5" />
      <path d="m5.4 8 1.2 1.2L9 7.1" />
      <path d="M14 6.5h6M14 10.5h5" />
      <rect x="4" y="14" width="6" height="6" rx="1.5" />
      <path d="M14 16.5h6M14 20h5" />
    </svg>
  )
}

export function IconCheck({ size = 13 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m3 8.3 3.1 3.1L13 4.7" />
    </svg>
  )
}

export function IconTrash({ size = 15 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4.5 7h15M9 4.5h6M7 7l.8 12h8.4L17 7" />
      <path d="M10 10.5v5M14 10.5v5" />
    </svg>
  )
}
