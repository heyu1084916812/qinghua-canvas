import { useState } from 'react'
import type {
  ContextKit,
  ContextKitColor,
  ContextKitFont,
  ContextKitVersion,
} from '../../domain/shared/context'
import { useAsset } from '../../features/shared/assets'
import { IconChevronLeft, IconSettings } from '../../workbenches/canvas/toolbar/icons'
import { MasonryGrid } from '../AssetsPage/MasonryGrid'
import styles from './ReferenceKitPanel.module.css'

type ItemKind = 'image' | 'color' | 'font'

type KitItem =
  | { kind: 'image'; id: string; hash: string; title: string }
  | { kind: 'color'; id: string; color: ContextKitColor }
  | { kind: 'font'; id: string; font: ContextKitFont }

export function ReferenceKitPanel({
  kit,
  version,
  onBack,
}: {
  kit: ContextKit
  version: ContextKitVersion | null
  onBack: () => void
}) {
  const items = itemsOf(version)
  const [enabled, setEnabled] = useState<Record<ItemKind, boolean>>({
    image: true,
    color: true,
    font: true,
  })
  const [filterOpen, setFilterOpen] = useState(false)
  const visible = items.filter((item) => enabled[item.kind])
  const toggle = (kind: ItemKind) => setEnabled((current) => ({ ...current, [kind]: !current[kind] }))

  return (
    <section
      className={styles.panel}
      data-reference-kit-panel={kit.id}
      aria-label={`套件 ${kit.name}`}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.stopPropagation()
        if (filterOpen) setFilterOpen(false)
        else onBack()
      }}
    >
      <header className={styles.head}>
        <button type="button" className={styles.iconButton} data-reference-kit-back aria-label="返回参考面板" title="返回参考面板" onClick={onBack}>
          <IconChevronLeft size={18} />
        </button>
        <h2>{kit.name}</h2>
        <button
          type="button"
          className={styles.iconButton}
          data-reference-kit-filter
          aria-label="筛选套件内容"
          title="筛选套件内容"
          aria-expanded={filterOpen}
          onClick={() => setFilterOpen((current) => !current)}
        >
          <IconSettings size={17} />
        </button>
      </header>
      {filterOpen ? (
        <div className={styles.filters} data-reference-kit-filter-panel>
          <fieldset>
            <legend>按来源</legend>
            <label><input type="checkbox" checked disabled />资产</label>
            <label className={styles.disabled}><input type="checkbox" disabled />文件</label>
            <label className={styles.disabled}><input type="checkbox" disabled />链接</label>
            <label className={styles.disabled}><input type="checkbox" disabled />连接器</label>
          </fieldset>
          <fieldset>
            <legend>按类型</legend>
            <label><input type="checkbox" data-reference-kit-filter-kind="image" checked={enabled.image} onChange={() => toggle('image')} />图片</label>
            <label><input type="checkbox" data-reference-kit-filter-kind="color" checked={enabled.color} onChange={() => toggle('color')} />颜色</label>
            <label><input type="checkbox" data-reference-kit-filter-kind="font" checked={enabled.font} onChange={() => toggle('font')} />字体</label>
          </fieldset>
        </div>
      ) : null}
      {!version ? (
        <p className={styles.empty}>这个套件还没有保存版本。</p>
      ) : visible.length === 0 ? (
        <p className={styles.empty}>当前筛选下没有套件内容。</p>
      ) : (
        <MasonryGrid minColumnWidth={132} gap={10} scope="reference-kit-items">
          {visible.map((item) => (
            <KitItemCard item={item} key={item.id} />
          ))}
        </MasonryGrid>
      )}
    </section>
  )
}

function KitItemCard({ item }: { item: KitItem }) {
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
  return <KitImage item={item} />
}

function KitImage({ item }: { item: Extract<KitItem, { kind: 'image' }> }) {
  const url = useAsset(item.hash)
  return (
    <article className={styles.item} data-reference-kit-item="image">
      <span className={styles.image}>
        {url ? <img src={url} alt={item.title} loading="lazy" /> : null}
      </span>
      <span className={styles.caption}>{item.title}</span>
    </article>
  )
}

function itemsOf(version: ContextKitVersion | null): KitItem[] {
  if (!version) return []
  return [
    ...version.resources.map((resource) => ({
      kind: 'image' as const,
      id: `image:${resource.hash}`,
      hash: resource.hash,
      title: resource.name || (resource.role === 'logo' ? '主素材' : '参考素材'),
    })),
    ...version.colors.map((color) => ({ kind: 'color' as const, id: `color:${color.id}`, color })),
    ...version.fonts.map((font) => ({ kind: 'font' as const, id: `font:${font.id}`, font })),
  ]
}
