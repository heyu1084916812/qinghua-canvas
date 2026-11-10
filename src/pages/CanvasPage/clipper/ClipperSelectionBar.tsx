import { useEffect, useState } from 'react'
import { CLIPPER_UNCATEGORIZED } from '../../../domain/inspiration/clipper'
import { IconDelete, IconGroup } from '../../../workbenches/canvas/toolbar/icons'
import styles from './ClipperSelectionBar.module.css'

export function ClipperSelectionBar({
  selectedCount,
  categories,
  onCancel,
  onDelete,
  onMove,
}: {
  selectedCount: number
  categories: readonly string[]
  onCancel: () => void
  onDelete: () => void
  onMove: (category: string) => void
}) {
  const [moveOpen, setMoveOpen] = useState(false)

  useEffect(() => {
    if (!moveOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMoveOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [moveOpen])

  return (
    <div className={styles.bar} data-clipper-selection-bar>
      <span className={styles.count}>已选 {selectedCount} 项</span>
      <div className={styles.actions}>
        <button type="button" className={styles.cancel} onClick={onCancel}>
          取消
        </button>
        <button
          type="button"
          className={styles.iconButton}
          data-clipper-selection-delete
          disabled={selectedCount === 0}
          aria-label="删除选中项"
          title="删除选中项"
          onClick={onDelete}
        >
          <IconDelete size={16} />
        </button>
        <div className={styles.moveWrap}>
          <button
            type="button"
            className={styles.iconButton}
            data-clipper-selection-move
            disabled={selectedCount === 0}
            aria-label="转到其他分组"
            title="转到其他分组"
            aria-expanded={moveOpen}
            onClick={() => setMoveOpen((current) => !current)}
          >
            <IconGroup size={16} />
          </button>
          {moveOpen ? (
            <div className={styles.moveMenu} role="menu" data-clipper-move-menu>
              <span>转到分组</span>
              <button
                type="button"
                role="menuitem"
                data-clipper-move-category={CLIPPER_UNCATEGORIZED}
                onClick={() => {
                  setMoveOpen(false)
                  onMove(CLIPPER_UNCATEGORIZED)
                }}
              >
                {CLIPPER_UNCATEGORIZED}
              </button>
              {categories.map((category) => (
                <button
                  key={category}
                  type="button"
                  role="menuitem"
                  data-clipper-move-category={category}
                  onClick={() => {
                    setMoveOpen(false)
                    onMove(category)
                  }}
                >
                  {category}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
