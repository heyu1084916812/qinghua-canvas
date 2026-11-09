import { useEffect, useRef } from 'react'
import type {
  ContextKitColor,
  ContextKitFont,
  ContextKitAssetRole,
  ContextKitVersion,
} from '../../domain/shared/context'
import { useAsset } from '../../features/shared/assets'
import { IconExpand } from '../../workbenches/canvas/toolbar/icons'
import { MasonryGrid } from '../AssetsPage/MasonryGrid'
import styles from './ReferenceKitItems.module.css'

export type KitItem =
  | {
      kind: 'image'
      id: string
      hash: string
      title: string
      role: ContextKitAssetRole
    }
  | { kind: 'color'; id: string; color: ContextKitColor }
  | { kind: 'font'; id: string; font: ContextKitFont }

export type KitImageItem = Extract<KitItem, { kind: 'image' }>

export function kitItemsOf(version: ContextKitVersion | null): KitItem[] {
  if (!version) return []
  return [
    ...version.resources.map((resource) => ({
      kind: 'image' as const,
      id: `image:${resource.hash}`,
      hash: resource.hash,
      title: resource.name || (resource.role === 'logo' ? '主素材' : '参考素材'),
      role: resource.role,
    })),
    ...version.colors.map((color) => ({
      kind: 'color' as const,
      id: `color:${color.id}`,
      color,
    })),
    ...version.fonts.map((font) => ({
      kind: 'font' as const,
      id: `font:${font.id}`,
      font,
    })),
  ]
}

export function ReferenceKitItems({
  items,
  onAdd,
  onOpen,
}: {
  items: readonly KitItem[]
  onAdd: (item: KitImageItem) => Promise<void>
  onOpen: (item: KitImageItem) => Promise<void>
}) {
  return (
    <MasonryGrid minColumnWidth={132} gap={10} scope="reference-kit-items">
      {items.map((item) => (
        <KitItemCard item={item} key={item.id} onAdd={onAdd} onOpen={onOpen} />
      ))}
    </MasonryGrid>
  )
}

function KitItemCard({
  item,
  onAdd,
  onOpen,
}: {
  item: KitItem
  onAdd: (item: KitImageItem) => Promise<void>
  onOpen: (item: KitImageItem) => Promise<void>
}) {
  if (item.kind === 'color') {
    return (
      <article className={styles.item} data-reference-kit-item="color">
        <span className={styles.color} style={{ background: item.color.value }} />
        <span className={styles.caption}>{item.color.name || item.color.value}</span>
        <span className={styles.meta}>{item.color.value}</span>
      </article>
    )
  }
  if (item.kind === 'font') {
    return (
      <article className={styles.item} data-reference-kit-item="font">
        <span className={styles.font}>Aa</span>
        <span className={styles.caption}>{item.font.name}</span>
        <span className={styles.meta}>{item.font.detail}</span>
      </article>
    )
  }
  return <KitImage item={item} onAdd={onAdd} onOpen={onOpen} />
}

function KitImage({
  item,
  onAdd,
  onOpen,
}: {
  item: KitImageItem
  onAdd: (item: KitImageItem) => Promise<void>
  onOpen: (item: KitImageItem) => Promise<void>
}) {
  const url = useAsset(item.hash)
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current)
  }, [])
  const add = () => {
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current)
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null
      void onAdd(item)
    }, 220)
  }
  const open = () => {
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current)
    clickTimerRef.current = null
    void onOpen(item)
  }
  return (
    <article className={styles.imageItem} data-reference-kit-item="image">
      <div className={styles.image}>
        <button
          type="button"
          className={styles.imageOpen}
          data-reference-kit-item-add={item.id}
          aria-label={`${item.title}，单击加入对话，双击放大`}
          onClick={add}
          onDoubleClick={open}
        >
          {url ? <img src={url} alt={item.title} loading="lazy" /> : null}
        </button>
        <button
          type="button"
          className={styles.imageExpand}
          data-reference-kit-item-expand={item.id}
          aria-label={`放大查看 ${item.title}`}
          title="放大查看"
          onClick={open}
        >
          <IconExpand size={14} />
        </button>
      </div>
      <span className={styles.caption}>{item.title}</span>
    </article>
  )
}
