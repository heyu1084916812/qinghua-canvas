import type { ContextKit, ContextKitVersion } from '../../domain/shared/context'
import type { ReferenceItem } from '../../domain/project/referenceLedger'
import { setReferenceDragData } from '../../features/canvas/dropImport'
import { useAsset } from '../../features/shared/assets'
import { IconExpand } from '../../workbenches/canvas/toolbar/icons'
import { KIT_KINDS } from '../AssetsPage/contextKitDraft'
import { ReferenceMedia } from './ReferenceMedia'
import styles from './ReferenceGridCards.module.css'

export function ReferenceCard({
  item,
  renaming,
  renameDraft,
  onRenameDraft,
  onRename,
  onCancelRename,
  onAdd,
  onOpen,
  onContextMenu,
}: {
  item: ReferenceItem
  renaming: boolean
  renameDraft: string
  onRenameDraft: (value: string) => void
  onRename: (item: ReferenceItem) => void
  onCancelRename: () => void
  onAdd: (item: ReferenceItem) => void
  onOpen: (item: ReferenceItem) => void
  onContextMenu: (item: ReferenceItem, x: number, y: number) => void
}) {
  return (
    <article
      className={styles.referenceCard}
      data-my-assets-reference={item.id}
      data-my-assets-reference-drag={item.id}
      draggable={!renaming}
      onDragStart={(event) => setReferenceDragData(event.dataTransfer, item.id)}
      onContextMenu={(event) => {
        event.preventDefault()
        onContextMenu(item, event.clientX, event.clientY)
      }}
      onKeyDown={(event) => {
        if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
        event.preventDefault()
        const rect = event.currentTarget.getBoundingClientRect()
        onContextMenu(
          item,
          rect.left + Math.min(32, rect.width / 2),
          rect.top + Math.min(32, rect.height / 2),
        )
      }}
    >
      <div className={styles.referenceMedia}>
        <button
          type="button"
          className={styles.referenceOpen}
          data-my-assets-reference-open={item.id}
          aria-label={`查看参考 ${item.title}`}
          onClick={() => onAdd(item)}
          onDoubleClick={() => item.assetHash && onOpen(item)}
        >
          <ReferenceMedia
            hash={item.assetHash}
            title={item.title}
            kind={item.kind === 'video' ? 'video' : 'image'}
          />
        </button>
        <button
          type="button"
          className={styles.referenceExpand}
          data-my-assets-reference-expand={item.id}
          aria-label={`放大查看 ${item.title}`}
          title="放大查看"
          onClick={() => onOpen(item)}
        >
          <IconExpand size={14} />
        </button>
      </div>
      <div className={styles.referenceCopy}>
        {renaming ? (
          <input
            className={styles.renameInput}
            autoFocus
            value={renameDraft}
            aria-label={`重命名参考 ${item.title}`}
            data-my-assets-reference-rename={item.id}
            onChange={(event) => onRenameDraft(event.target.value)}
            onBlur={() => onRename(item)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                event.currentTarget.blur()
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                onCancelRename()
              }
            }}
          />
        ) : (
          <span title={item.what || item.title}>{item.what || item.title}</span>
        )}
      </div>
    </article>
  )
}

export function KitFolder({
  kit,
  version,
  onAdd,
  onOpen,
}: {
  kit: ContextKit
  version: ContextKitVersion | null
  onAdd: () => void
  onOpen: () => void
}) {
  const preview = version?.resources.find((item) => item.role === 'logo') ?? version?.resources[0]
  const url = useAsset(preview?.hash ?? '')
  const typeLabel = KIT_KINDS.find((item) => item.value === kit.kind)?.label ?? '套件'
  return (
    <article
      className={styles.kitFolderCard}
      data-my-assets-kit-folder={kit.id}
      onClick={onAdd}
    >
      <button
        type="button"
        className={styles.kitFolderButton}
        data-my-assets-kit-folder-add={kit.id}
        aria-label={`将套件 ${kit.name} 加入对话`}
        onClick={(event) => {
          event.stopPropagation()
          onAdd()
        }}
      >
        <span className={styles.kitFolderStack}>
          <span className={styles.kitFolderLayerBack} />
          <span className={styles.kitFolderLayerFront} />
          <span className={styles.kitFolderFace}>
            {url ? <img src={url} alt="" /> : <span>{kit.name.slice(0, 1)}</span>}
          </span>
        </span>
        <span className={styles.kitFolderCopy}>{kit.name}</span>
      </button>
      <button
        type="button"
        className={styles.kitFolderOpen}
        data-my-assets-kit-folder-open={kit.id}
        aria-label={`打开套件 ${kit.name}`}
        title="打开套件"
        onClick={(event) => {
          event.stopPropagation()
          onOpen()
        }}
      >
        打开
      </button>
      <span className={styles.srOnly}>{typeLabel}</span>
    </article>
  )
}
