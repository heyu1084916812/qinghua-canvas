import { useState, type MouseEvent } from 'react'
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
import styles from './MyAssetsKitDetail.module.css'

export type KitMenuKey = `asset:${string}` | `color:${string}` | `font:${string}`

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
  openMenu: KitMenuKey | null
  onUpload: () => void
  onAdd: (item: ContextKitAsset) => void
  onMenu: (key: KitMenuKey | null) => void
  onReupload: (item: ContextKitAsset) => void
  onDelete: (item: ContextKitAsset) => void
}) {
  return (
    <section className={styles.section}>
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
          <article className={styles.mediaCard} key={item.hash}>
            <AssetImage item={item} />
            <small>{item.name || '套件素材'}</small>
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
            <MenuButton
              keyName={`asset:${item.hash}`}
              kind="asset"
              itemId={item.hash}
              openMenu={openMenu}
              setOpenMenu={onMenu}
              label={`编辑 ${item.name}`}
            />
            {openMenu === `asset:${item.hash}` ? (
              <div className={styles.menu} role="menu" data-my-assets-kit-actions>
                <button
                  type="button"
                  role="menuitem"
                  data-my-assets-kit-asset-reupload
                  onClick={() => onReupload(item)}
                >
                  <IconImageUpload size={14} /> 重新上传
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.danger}
                  data-my-assets-kit-asset-delete
                  onClick={() => onDelete(item)}
                >
                  <IconDelete size={14} /> 删除
                </button>
              </div>
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
  openMenu: KitMenuKey | null
  onMenu: (key: KitMenuKey | null) => void
  onAdd: (value: string, name: string) => Promise<void>
  onUpdate: (id: string, value: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const [editingColorId, setEditingColorId] = useState<string | null>(null)
  const [colorNameDraft, setColorNameDraft] = useState('')

  return (
    <section className={styles.section}>
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
            <small>{color.value}</small>
            <MenuButton
              keyName={`color:${color.id}`}
              kind="color"
              itemId={color.id}
              openMenu={openMenu}
              setOpenMenu={onMenu}
              label={`编辑颜色 ${color.name}`}
            />
            {openMenu === `color:${color.id}` ? (
              <div className={styles.menu} role="menu" data-my-assets-kit-actions>
                <button
                  type="button"
                  role="menuitem"
                  data-my-assets-kit-color-edit
                  onClick={() => {
                    setEditingColorId(color.id)
                    onMenu(null)
                  }}
                >
                  <IconRename size={14} /> 编辑
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.danger}
                  data-my-assets-kit-color-delete
                  onClick={() => void onDelete(color.id)}
                >
                  <IconDelete size={14} /> 删除
                </button>
              </div>
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
  openMenu: KitMenuKey | null
  onMenu: (key: KitMenuKey | null) => void
  onAdd: (event: MouseEvent<HTMLButtonElement>) => void
  onEdit: (event: MouseEvent<HTMLButtonElement>, id: string) => void
  onUpload: (id: string) => void
  onDelete: (id: string) => Promise<void>
}) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h3>字体</h3>
        <button
          type="button"
          className={styles.textAction}
          data-my-assets-kit-font-add
          disabled={fontLibrary.length === 0}
          onClick={onAdd}
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
              <small>{font.name}</small>
              <MenuButton
                keyName={`font:${font.id}`}
                kind="font"
                itemId={font.id}
                openMenu={openMenu}
                setOpenMenu={onMenu}
                label={`编辑字体 ${font.name}`}
              />
              {openMenu === `font:${font.id}` ? (
                <div className={styles.menu} role="menu" data-my-assets-kit-actions>
                  <button
                    type="button"
                    role="menuitem"
                    data-my-assets-kit-font-edit
                    onClick={(event) => onEdit(event, font.id)}
                  >
                    <IconRename size={14} /> 编辑
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    data-my-assets-kit-font-reupload
                    onClick={() => onUpload(font.id)}
                  >
                    <IconImageUpload size={14} /> 重新上传
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className={styles.danger}
                    data-my-assets-kit-font-delete
                    onClick={() => void onDelete(font.id)}
                  >
                    <IconDelete size={14} /> 删除
                  </button>
                </div>
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
  openMenu: KitMenuKey | null
  setOpenMenu: (key: KitMenuKey | null) => void
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
      aria-expanded={openMenu === keyName}
      onClick={() => setOpenMenu(openMenu === keyName ? null : keyName)}
    >
      <IconMore size={15} />
    </button>
  )
}
