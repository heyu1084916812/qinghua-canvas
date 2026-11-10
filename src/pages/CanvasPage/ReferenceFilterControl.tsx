import { useEffect, useRef, useState } from 'react'
import {
  REFERENCE_KIND_FILTERS,
  REFERENCE_SOURCE_FILTERS,
  ReferenceFilterButton,
  ReferenceFilterFields,
  type ReferenceKindFilter,
  type ReferenceSourceFilter,
} from './ReferenceFilterFields'
import styles from './ReferenceFilterFields.module.css'

export function ReferenceFilterControl({
  scope,
  label,
  sourceValues,
  kindValues,
  sourceOptions,
  kindOptions,
  disabledSources,
  disabledKinds,
  onToggleSource,
  onToggleKind,
}: {
  scope: 'source' | 'kit'
  label: string
  sourceValues: ReadonlySet<ReferenceSourceFilter>
  kindValues: ReadonlySet<ReferenceKindFilter>
  sourceOptions?: typeof REFERENCE_SOURCE_FILTERS
  kindOptions?: typeof REFERENCE_KIND_FILTERS
  disabledSources?: ReadonlySet<ReferenceSourceFilter>
  disabledKinds?: ReadonlySet<ReferenceKindFilter>
  onToggleSource: (value: ReferenceSourceFilter) => void
  onToggleKind: (value: ReferenceKindFilter) => void
}) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => {
      if (!anchorRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      setOpen(false)
    }
    document.addEventListener('pointerdown', close, true)
    document.addEventListener('keydown', escape, true)
    return () => {
      document.removeEventListener('pointerdown', close, true)
      document.removeEventListener('keydown', escape, true)
    }
  }, [open])

  return (
    <div className={styles.anchor} ref={anchorRef}>
      <ReferenceFilterButton
        scope={scope}
        open={open}
        label={label}
        onToggle={() => setOpen((current) => !current)}
      />
      {open ? (
        <ReferenceFilterFields
          scope={scope}
          sourceValues={sourceValues}
          kindValues={kindValues}
          sourceOptions={sourceOptions}
          kindOptions={kindOptions}
          disabledSources={disabledSources}
          disabledKinds={disabledKinds}
          onToggleSource={onToggleSource}
          onToggleKind={onToggleKind}
        />
      ) : null}
    </div>
  )
}
