import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { UserFont } from '../../domain/ui/fonts'
import { IconSearch } from '../../app/SettingsIcons'
import styles from './KitFontPicker.module.css'

export interface PickerAnchor {
  left: number
  right: number
  top: number
  bottom: number
}

export function KitFontPicker({
  anchor,
  fonts,
  selectedFontId,
  onSelect,
  onClose,
}: {
  anchor: PickerAnchor
  fonts: readonly UserFont[]
  selectedFontId?: string
  onSelect: (font: UserFont) => void
  onClose: () => void
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const filtered = fonts.filter((font) => {
    const needle = query.trim().toLowerCase()
    return !needle || font.name.toLowerCase().includes(needle)
  })

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => searchRef.current?.focus())
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onClose()
    }
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    document.addEventListener('pointerdown', close, true)
    document.addEventListener('keydown', key, true)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('pointerdown', close, true)
      document.removeEventListener('keydown', key, true)
    }
  }, [onClose])

  const width = 300
  const gap = 8
  const left = Math.max(gap, Math.min(anchor.left, window.innerWidth - width - gap))
  const top = Math.max(gap, Math.min(anchor.bottom + 6, window.innerHeight - 420))

  return createPortal(
    <div
      ref={rootRef}
      className={styles.picker}
      style={{ left, top, width }}
      role="dialog"
      aria-label="从字体库选择"
      data-my-assets-font-picker
    >
      <label className={styles.search}>
        <IconSearch size="sm" />
        <input
          ref={searchRef}
          value={query}
          placeholder="搜索"
          aria-label="搜索字体"
          data-my-assets-font-search
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div className={styles.heading}>全部字体</div>
      <div className={styles.list} role="listbox" aria-label="已保存字体">
        {filtered.length === 0 ? (
          <p className={styles.empty}>字体库中还没有可用字体。</p>
        ) : (
          filtered.map((font) => (
            <button
              key={font.id}
              type="button"
              role="option"
              aria-selected={selectedFontId === font.id}
              className={styles.item}
              style={{ fontFamily: `'${font.family}'` }}
              data-my-assets-font-option={font.id}
              onClick={() => onSelect(font)}
            >
              <span>{font.name}</span>
              <small>{font.format.toUpperCase()}</small>
            </button>
          ))
        )}
      </div>
    </div>,
    document.body,
  )
}
