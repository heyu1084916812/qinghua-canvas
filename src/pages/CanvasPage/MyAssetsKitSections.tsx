import { useState } from 'react'
import { IconImageUpload } from '../../app/SettingsIcons'
import type { ContextKitAsset, ContextKitColor, ContextKitFont } from '../../domain/shared/context'
import type { UserFont } from '../../domain/ui/fonts'
import { useAsset } from '../../features/shared/assets'
import { ColorPickerPopover } from '../../features/shared/colorPicker/ColorPickerPopover'
import { readableTextColor } from '../../features/shared/colorPicker/colorMath'
import {
  IconDelete,
  IconMore,
  IconPlus,
  IconRename,
} from '../../workbenches/canvas/toolbar/icons'
import {
  ReferenceCardActionMenu,
} from './ReferenceCardActionMenu'
import type { PickerAnchor } from './KitFontPicker'
import styles from './MyAssetsKitDetail.module.css'

export type KitMenuKey = `asset:${string}` | `color:${string}` | `font:${string}`
export interface KitMenuState {
  key: KitMenuKey
  x: number
  y: number
}

export function KitAssetsSection({
  title,
  role,
  items,
  openMenu,
  onUpload,
  onAdd,
  onMenu,
  onReupload,
  onDelete,
}: {
  title: string
  role: ContextKitAsset['role']
  items: readonly ContextKitAsset[]
  openMenu: KitMenuState | null
  onUpload: () => void
  onAdd: (item: ContextKitAsset) => void
  onMenu: (state: KitMenuState | null) => void
  onReupload: (item: ContextKitAsset) => void
  onDelete: (item: ContextKitAsset) => void
}) {
  return (
    <section className={styles.section} data-my-assets-kit-section="image">
      <div className={styles.sectionHead}>
        <h3>{title}</h3>
        <button
          type="button"
          className={styles.textAction}
          data-my-assets-kit-upload={role}
          onClick={onUpload}
        >
          + 添加
        </button>
      </div>
      <div className={styles.mediaGrid}>
        {items.map((item) => (
          <article
            className={styles.mediaCard}
            key={item.hash}
            data-my-assets-kit-asset-card={item.hash}
          >
            <div className={styles.mediaThumb} data-my-assets-kit-asset-thumb>
              <AssetImage item={item} />
              <button
                type="button"
                className={styles.assetAdd}
                data-my-assets-kit-asset-add={item.hash}
                aria-label={`将 ${item.name} 添加到对话`}
                title="添加到对话"
                onClick={() => onAdd(item)}
              >
                <IconPlus size={14} />
              </button>
            </div>
            <div className={styles.mediaMeta} data-my-assets-kit-asset-meta>
              <small>{item.name || '套件素材'}</small>
              <MenuButton
                keyName={`asset:${item.hash}`}
                kind="asset"
                itemId={item.hash}
                openMenu={openMenu}
                setOpenMenu={onMenu}
                label={`编辑 ${item.name}`}
              />
            </div>
            {openMenu?.key === `asset:${item.hash}` ? (
              <ReferenceCardActionMenu
                x={openMenu.x}
                y={openMenu.y}
                actions={[
                  {
                    id: 'reupload',
                    label: '重新上传',
                    icon: <IconImageUpload size={14} />,
                    onSelect: () => onReupload(item),
                  },
                  {
                    id: 'delete',
                    label: '删除',
                    icon: <IconDelete size={14} />,
                    danger: true,
                    onSelect: () => onDelete(item),
                  },
                ]}
                onClose={() => onMenu(null)}
              />
            ) : null}
          </article>
        ))}
      </div>
    </section>
  )
}

export function KitColorsSection({
  colors,
  openMenu,
  onMenu,
  onAdd,
  onUpdate,
  onDelete,
}: {
  colors: readonly ContextKitColor[]
  openMenu: KitMenuState | null
  onMenu: (state: KitMenuState | null) => void
  onAdd: (value: string, name: string) => Promise<void>
  onUpdate: (id: string, value: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const [editingColorId, setEditingColorId] = useState<string | null>(null)
  const [colorNameDraft, setColorNameDraft] = useState('')

  return (
    <section className={styles.section} data-my-assets-kit-section="color">
      <div className={styles.sectionHead}>
        <h3>颜色</h3>
        <ColorPickerPopover
          value="#8fc466"
          target="my-assets-kit-color-add"
          showName
          nameValue={colorNameDraft}
          namePlaceholder="颜色名称，例如主色"
          confirmLabel="添加"
          onNameChange={setColorNameDraft}
          onCommit={(value) => {
            void onAdd(value, colorNameDraft)
            setColorNameDraft('')
          }}
          renderTrigger={({ open, toggle }) => (
            <button
              type="button"
              className={styles.textAction}
              aria-expanded={open}
              data-my-assets-kit-color-add
              onClick={toggle}
            >
              + 添加
            </button>
          )}
        />
      </div>
      <div className={styles.colorList}>
        {colors.map((color) => (
          <article className={styles.colorCard} key={color.id}>
            <span
              className={styles.colorSwatch}
              style={{ background: color.value, color: readableTextColor(color.value) }}
            >
              {color.name}
            </span>
            <div className={styles.mediaMeta}>
              <small>{color.value}</small>
              <MenuButton
                keyName={`color:${color.id}`}
                kind="color"
                itemId={color.id}
                openMenu={openMenu}
                setOpenMenu={onMenu}
                label={`编辑颜色 ${color.name}`}
              />
            </div>
            {openMenu?.key === `color:${color.id}` ? (
              <ReferenceCardActionMenu
                x={openMenu.x}
                y={openMenu.y}
                actions={[
                  {
                    id: 'edit',
                    label: '编辑',
                    icon: <IconRename size={14} />,
                    onSelect: () => setEditingColorId(color.id),
                  },
                  {
                    id: 'delete',
                    label: '删除',
                    icon: <IconDelete size={14} />,
                    danger: true,
                    onSelect: () => void onDelete(color.id),
                  },
                ]}
                onClose={() => onMenu(null)}
              />
            ) : null}
            {editingColorId === color.id ? (
              <ColorPickerPopover
                open
                value={color.value}
                target={`my-assets-kit-color-${color.id}`}
                onOpenChange={(open) => {
                  if (!open) setEditingColorId(null)
                }}
                onCommit={(value) => void onUpdate(color.id, value)}
                renderTrigger={() => <span className={styles.anchor} />}
              />
            ) : null}
          </article>
        ))}
      </div>
    </section>
  )
}

export function KitFontsSection({
  fonts,
  fontLibrary,
  openMenu,
  onMenu,
  onAdd,
  onEdit,
  onUpload,
  onDelete,
}: {
  fonts: readonly ContextKitFont[]
  fontLibrary: readonly UserFont[]
  openMenu: KitMenuState | null
  onMenu: (state: KitMenuState | null) => void
  onAdd: (anchor: PickerAnchor) => void
  onEdit: (anchor: PickerAnchor, id: string) => void
  onUpload: (id: string) => void
  onDelete: (id: string) => Promise<void>
}) {
  return (
    <section className={styles.section} data-my-assets-kit-section="font">
      <div className={styles.sectionHead}>
        <h3>字体</h3>
        <button
          type="button"
          className={styles.textAction}
          data-my-assets-kit-font-add
          disabled={fontLibrary.length === 0}
          onClick={(event) => onAdd(anchorOf(event.currentTarget))}
        >
          + 添加
        </button>
      </div>
      <div className={styles.fontList}>
        {fonts.map((font) => {
          const registered = fontLibrary.find((item) => item.id === font.fontId)
          return (
            <article className={styles.fontCard} key={font.id}>
              <strong
                style={
                  registered
                    ? { fontFamily: `'${registered.family}'` }
                    : undefined
                }
              >
                Ag
              </strong>
              <div className={styles.mediaMeta}>
                <small>{font.name}</small>
                <MenuButton
                  keyName={`font:${font.id}`}
                  kind="font"
                  itemId={font.id}
                  openMenu={openMenu}
                  setOpenMenu={onMenu}
                  label={`编辑字体 ${font.name}`}
                />
              </div>
              {openMenu?.key === `font:${font.id}` ? (
                <ReferenceCardActionMenu
                  x={openMenu.x}
                  y={openMenu.y}
                  actions={[
                    {
                      id: 'edit',
                      label: '编辑',
                      icon: <IconRename size={14} />,
                      onSelect: () =>
                        onEdit(
                          {
                            left: openMenu.x,
                            right: openMenu.x,
                            top: openMenu.y,
                            bottom: openMenu.y,
                          },
                          font.id,
                        ),
                    },
                    {
                      id: 'reupload',
                      label: '重新上传',
                      icon: <IconImageUpload size={14} />,
                      onSelect: () => onUpload(font.id),
                    },
                    {
                      id: 'delete',
                      label: '删除',
                      icon: <IconDelete size={14} />,
                      danger: true,
                      onSelect: () => void onDelete(font.id),
                    },
                  ]}
                  onClose={() => onMenu(null)}
                />
              ) : null}
            </article>
          )
        })}
      </div>
    </section>
  )
}

function AssetImage({ item }: { item: ContextKitAsset }) {
  const url = useAsset(item.hash)
  return url ? <img src={url} alt={item.name} loading="lazy" /> : <span aria-hidden />
}

function MenuButton({
  keyName,
  kind,
  itemId,
  openMenu,
  setOpenMenu,
  label,
}: {
  keyName: KitMenuKey
  kind: 'asset' | 'color' | 'font'
  itemId: string
  openMenu: KitMenuState | null
  setOpenMenu: (state: KitMenuState | null) => void
  label: string
}) {
  return (
    <button
      type="button"
      className={styles.more}
      data-my-assets-kit-actions
      data-my-assets-kit-menu={kind}
      data-my-assets-kit-menu-id={itemId}
      aria-label={label}
      aria-expanded={openMenu?.key === keyName}
      onClick={(event) => {
        if (openMenu?.key === keyName) {
          setOpenMenu(null)
          return
        }
        setOpenMenu({
          key: keyName,
          x: event.currentTarget.getBoundingClientRect().left,
          y: event.currentTarget.getBoundingClientRect().bottom + 4,
        })
      }}
    >
      <IconMore size={15} />
    </button>
  )
}

function anchorOf(element: HTMLElement): PickerAnchor {
  const rect = element.getBoundingClientRect()
  return {
    left: rect.left,
    right: rect.right,
    top: rect.top,
    bottom: rect.bottom,
  }
}
