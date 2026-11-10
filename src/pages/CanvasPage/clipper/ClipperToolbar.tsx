import { useState, type FormEvent } from 'react'
import { CLIPPER_UNCATEGORIZED } from '../../../domain/inspiration/clipper'
import { IconClose, IconPlus, IconSliders } from '../../../workbenches/canvas/toolbar/icons'
import styles from './ClipperToolbar.module.css'

export type ClipperFilter = 'all' | 'uncategorized' | `category:${string}`

export function clipperCategoryFilter(category: string): ClipperFilter {
  return `category:${category}`
}

export function clipperFilterCategory(filter: ClipperFilter): string | null {
  if (filter === 'all') return null
  if (filter === 'uncategorized') return CLIPPER_UNCATEGORIZED
  return filter.slice('category:'.length)
}

export function ClipperToolbar({
  categories,
  filter,
  selectionMode,
  onFilter,
  onToggleSelection,
  onCreateCategory,
}: {
  categories: readonly string[]
  filter: ClipperFilter
  selectionMode: boolean
  onFilter: (filter: ClipperFilter) => void
  onToggleSelection: () => void
  onCreateCategory: (name: string) => Promise<void>
}) {
  const [createOpen, setCreateOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const name = draft.trim()
    if (!name || busy) return
    setBusy(true)
    setError('')
    try {
      await onCreateCategory(name)
      setDraft('')
      setCreateOpen(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.toolbar} data-clipper-toolbar>
      <div className={styles.tabs} role="tablist" aria-label="图片收藏筛选">
        <FilterTab
          active={filter === 'all'}
          label="全部"
          value="all"
          onSelect={onFilter}
        />
        <FilterTab
          active={filter === 'uncategorized'}
          label={CLIPPER_UNCATEGORIZED}
          value="uncategorized"
          onSelect={onFilter}
        />
        {categories.map((category) => (
          <FilterTab
            key={category}
            active={filter === clipperCategoryFilter(category)}
            label={category}
            value={clipperCategoryFilter(category)}
            onSelect={onFilter}
          />
        ))}
      </div>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.iconButton}
          data-clipper-create-category
          aria-label="新建分类"
          title="新建分类"
          aria-expanded={createOpen}
          onClick={() => {
            setCreateOpen((current) => !current)
            setError('')
          }}
        >
          <IconPlus size={17} />
        </button>
        <button
          type="button"
          className={styles.iconButton}
          data-clipper-selection-toggle
          aria-label={selectionMode ? '退出多选' : '多选'}
          title={selectionMode ? '退出多选' : '多选'}
          aria-pressed={selectionMode}
          onClick={onToggleSelection}
        >
          <IconSliders size={17} />
        </button>
      </div>

      {createOpen ? (
        <form className={styles.createPanel} data-clipper-create-panel onSubmit={(event) => void submit(event)}>
          <label className={styles.field}>
            <span>分类名称</span>
            <input
              autoFocus
              value={draft}
              maxLength={24}
              data-clipper-category-input
              placeholder="例如：美工部"
              onChange={(event) => {
                setDraft(event.target.value)
                setError('')
              }}
            />
          </label>
          <div className={styles.formActions}>
            <button
              type="button"
              className={styles.cancel}
              onClick={() => setCreateOpen(false)}
            >
              取消
            </button>
            <button
              type="submit"
              className={styles.submit}
              disabled={busy || !draft.trim()}
            >
              {busy ? '创建中…' : '创建'}
            </button>
          </div>
          {error ? (
            <p className={styles.error} role="status">
              <IconClose size={13} />
              {error}
            </p>
          ) : null}
        </form>
      ) : null}
    </div>
  )
}

function FilterTab({
  active,
  label,
  value,
  onSelect,
}: {
  active: boolean
  label: string
  value: ClipperFilter
  onSelect: (filter: ClipperFilter) => void
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={active ? styles.tabOn : styles.tab}
      data-clipper-filter={value}
      onClick={() => onSelect(value)}
    >
      {label}
    </button>
  )
}
