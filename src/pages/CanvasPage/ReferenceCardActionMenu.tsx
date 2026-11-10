import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import styles from './ReferenceCardActionMenu.module.css'

export interface ReferenceCardAction {
  id: string
  label: string
  icon?: ReactNode
  shortcut?: string
  danger?: boolean
  disabled?: boolean
  onSelect: () => void
}

export function ReferenceCardActionMenu({
  x,
  y,
  actions,
  onClose,
}: {
  x: number
  y: number
  actions: readonly ReferenceCardAction[]
  onClose: () => void
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: x, top: y })

  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!menu) return
    const rect = menu.getBoundingClientRect()
    setPosition({
      left: Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)),
    })
  }, [x, y])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus()
    })
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose()
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

  return createPortal(
    <div
      ref={menuRef}
      className={styles.menu}
      style={position}
      role="menu"
      data-reference-card-menu
    >
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          role="menuitem"
          className={action.danger ? styles.danger : undefined}
          disabled={action.disabled}
          data-reference-card-action={action.id}
          onClick={() => {
            action.onSelect()
            onClose()
          }}
        >
          <span className={styles.icon}>{action.icon}</span>
          <span>{action.label}</span>
          {action.shortcut ? <kbd>{action.shortcut}</kbd> : null}
        </button>
      ))}
    </div>,
    document.body,
  )
}
