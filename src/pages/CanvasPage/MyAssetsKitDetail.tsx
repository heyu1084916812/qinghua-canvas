import { useEffect, useMemo, useRef, useState } from 'react'
import { usePlatform } from '../../app/providers/PlatformProvider'
import { useFonts } from '../../app/providers/FontProvider'
import type { ContextKit, ContextKitAsset, ContextKitColor, ContextKitFont, ContextKitVersion } from '../../domain/shared/context'
import { FONT_FORMATS, type UserFont } from '../../domain/ui/fonts'
import { sendReferenceToAgent } from '../../features/canvas/agentHandoff'
import { importAssetFile, IMPORT_ACCEPT } from '../../features/canvas/importAsset'
import { ensureKitAssetReference } from '../../features/canvas/kitReference'
import { createContextRepository } from '../../state/shared/contextRepository'
import type { CanvasStore } from '../../state/workbenches/canvas/store'
import { createId } from '../../shared/id'
import {
  IconChevronLeft,
  IconMore,
} from '../../workbenches/canvas/toolbar/icons'
import { KitFontPicker, type PickerAnchor } from './KitFontPicker'
import {
  KitAssetsSection,
  KitColorsSection,
  KitFontsSection,
  type KitMenuState,
} from './MyAssetsKitSections'
import styles from './MyAssetsKitDetail.module.css'

type ImageTarget = { role: ContextKitAsset['role']; replace?: ContextKitAsset }
type FontPickerState = { replaceId?: string; anchor: PickerAnchor }

const IMAGE_ACCEPT = IMPORT_ACCEPT.split(',').filter((type) => type.startsWith('image/')).join(',')

export function MyAssetsKitDetail({
  projectId,
  store,
  kit,
  version,
  onBack,
  onOpenEditor,
  onAddKit,
  onVersionChange,
}: {
  projectId: string
  store: CanvasStore
  kit: ContextKit
  version: ContextKitVersion | null
  onBack: () => void
  onOpenEditor: () => void
  onAddKit: () => Promise<void>
  onVersionChange: (version: ContextKitVersion) => void
}) {
  const platform = usePlatform()
  const fontLibrary = useFonts()
  const repository = useMemo(
    () => createContextRepository(platform.storage),
    [platform.storage],
  )
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  const fontInputRef = useRef<HTMLInputElement | null>(null)
  const [current, setCurrent] = useState(version)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [openMenu, setOpenMenu] = useState<KitMenuState | null>(null)
  const [imageTarget, setImageTarget] = useState<ImageTarget | null>(null)
  const [fontReplaceId, setFontReplaceId] = useState<string | null>(null)
  const [fontPicker, setFontPicker] = useState<FontPickerState | null>(null)
  const [editingDescription, setEditingDescription] = useState(false)
  const [descriptionDraft, setDescriptionDraft] = useState(
    version?.guide || kit.description,
  )

  useEffect(() => {
    setCurrent(version)
    setDescriptionDraft(version?.guide || kit.description)
  }, [kit.description, version])

  const logo = current?.resources.filter((item) => item.role === 'logo') ?? []
  const photos = current?.resources.filter((item) => item.role !== 'logo') ?? []

  const saveVersion = async (
    patch: { description?: string; guide?: string; resources?: ContextKitAsset[]; colors?: ContextKitColor[]; fonts?: ContextKitFont[] },
    success: string,
  ) => {
    if (!current || busy) return false
    setBusy(true)
    setStatus('')
    try {
      const resources = patch.resources ?? current.resources
      const saved = await repository.saveKitVersion(kit.id, {
        guide: patch.guide ?? current.guide,
        facts: current.facts,
        resources,
        assetHashes: [...new Set(resources.map((resource) => resource.hash))],
        colors: patch.colors ?? current.colors,
        fonts: patch.fonts ?? current.fonts,
        ...(patch.description !== undefined ? { description: patch.description } : {}),
      })
      if (!saved) throw new Error('这个套件已经不存在')
      setCurrent(saved.version)
      onVersionChange(saved.version)
      setStatus(success)
      return true
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '保存套件失败')
      return false
    } finally {
      setBusy(false)
    }
  }

  const chooseImage = (target: ImageTarget) => {
    setOpenMenu(null)
    setImageTarget(target)
    imageInputRef.current?.click()
  }

  const importImage = async (file: File | undefined) => {
    if (!file || !imageTarget || busy) return
    const target = imageTarget
    setImageTarget(null)
    try {
      const asset = await importAssetFile({ platform, store, projectId }, file)
      if (!asset || !asset.mime.startsWith('image/')) {
        throw new Error('请选择图片文件')
      }
      if (!target.replace && current?.resources.some((item) => item.hash === asset.hash)) {
        throw new Error('这张图片已经在套件中')
      }
      const resource: ContextKitAsset = {
        hash: asset.hash,
        role: target.role,
        name: target.replace?.name || (asset.name ?? '套件素材').replace(/\.[^.]+$/, '').trim() || '套件素材',
      }
      const resources = target.replace
        ? current?.resources.map((item) =>
            item.hash === target.replace?.hash ? resource : item,
          ) ?? []
        : [...(current?.resources ?? []), resource]
      await saveVersion(
        { resources },
        target.replace ? '图片已重新上传' : '图片已添加',
      )
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '上传图片失败')
    } finally {
      if (imageInputRef.current) imageInputRef.current.value = ''
    }
  }

  const removeResource = async (resource: ContextKitAsset) => {
    setOpenMenu(null)
    const resources = current?.resources.filter((item) => item.hash !== resource.hash) ?? []
    await saveVersion({ resources }, '图片已删除')
  }

  const addImageToAgent = async (resource: ContextKitAsset) => {
    if (!current || busy) return
    try {
      const reference = await ensureKitAssetReference(
        platform,
        projectId,
        kit,
        current,
        { hash: resource.hash, role: resource.role, name: resource.name },
      )
      sendReferenceToAgent(projectId, [{ id: reference.id, label: reference.title }])
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '加入对话失败')
    }
  }

  const updateColor = async (colorId: string, value: string) => {
    const colors = current?.colors.map((item) =>
      item.id === colorId ? { ...item, value } : item,
    ) ?? []
    await saveVersion({ colors }, '颜色已更新')
  }

  const removeColor = async (colorId: string) => {
    setOpenMenu(null)
    await saveVersion(
      { colors: current?.colors.filter((item) => item.id !== colorId) ?? [] },
      '颜色已删除',
    )
  }

  const addColor = async (value: string, name: string) => {
    const color: ContextKitColor = {
      id: createId('kitcolor'),
      name: name.trim() || '品牌颜色',
      value,
    }
    await saveVersion(
      { colors: [...(current?.colors ?? []), color] },
      '颜色已添加',
    )
  }

  const chooseFont = (anchor: PickerAnchor, replaceId?: string) => {
    setFontPicker({
      replaceId,
      anchor,
    })
    setOpenMenu(null)
  }

  const selectFont = async (font: UserFont) => {
    const replaceId = fontPicker?.replaceId
    const entry: ContextKitFont = {
      id: replaceId ?? createId('kitfont'),
      name: font.name,
      detail: font.weight === 700 ? '粗体 700' : '常规体 400',
      fontId: font.id,
      format: font.format,
      size: font.size,
    }
    const fonts = replaceId
      ? current?.fonts.map((item) => (item.id === replaceId ? entry : item)) ?? []
      : current?.fonts.some((item) => item.fontId === font.id)
        ? current?.fonts ?? []
        : [...(current?.fonts ?? []), entry]
    setFontPicker(null)
    await saveVersion(
      { fonts },
      replaceId ? '字体已替换' : '字体已添加',
    )
  }

  const replaceFontFile = async (file: File | undefined) => {
    if (!file || busy) return
    const replaceId = fontReplaceId
    setFontReplaceId(null)
    try {
      const result = await fontLibrary.importFont({
        name: file.name,
        size: file.size,
        bytes: await file.arrayBuffer(),
      })
      if (!result.ok) throw new Error(result.reason)
      const entry: ContextKitFont = {
        id: replaceId ?? createId('kitfont'),
        name: result.font.name,
        detail: result.font.weight === 700 ? '粗体 700' : '常规体 400',
        fontId: result.font.id,
        format: result.font.format,
        size: result.font.size,
      }
      const fonts = replaceId
        ? current?.fonts.map((item) => (item.id === replaceId ? entry : item)) ?? []
        : [...(current?.fonts ?? []), entry]
      await saveVersion({ fonts }, '字体已重新上传')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '上传字体失败')
    } finally {
      if (fontInputRef.current) fontInputRef.current.value = ''
    }
  }

  const saveDescription = async () => {
    const description = descriptionDraft.trim()
    const saved = await saveVersion(
      { guide: description, description },
      '描述已更新',
    )
    if (saved) setEditingDescription(false)
  }

  return (
    <section className={styles.detail} data-my-assets-kit-detail={kit.id}>
      <header className={styles.head}>
        <button
          type="button"
          className={styles.iconButton}
          data-my-assets-kit-back
          aria-label="返回套件列表"
          title="返回套件列表"
          onClick={onBack}
        >
          <IconChevronLeft size={18} />
        </button>
        <h2>{kit.name}</h2>
        <button
          type="button"
          className={styles.iconButton}
          aria-label="管理套件"
          title="管理套件"
          onClick={onOpenEditor}
        >
          <IconMore size={18} />
        </button>
      </header>

      <input
        ref={imageInputRef}
        type="file"
        accept={IMAGE_ACCEPT}
        hidden
        data-my-assets-kit-image-file
        onChange={(event) => void importImage(event.target.files?.[0])}
      />
      <input
        ref={fontInputRef}
        type="file"
        accept={FONT_FORMATS.map((format) => `.${format}`).join(',')}
        hidden
        data-my-assets-kit-font-file
        onChange={(event) => void replaceFontFile(event.target.files?.[0])}
      />

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h3>描述</h3>
          <button
            type="button"
            className={styles.textAction}
            data-my-assets-kit-description-edit
            onClick={() => setEditingDescription(true)}
          >
            编辑
          </button>
        </div>
        {editingDescription ? (
          <div className={styles.descriptionEditor}>
            <textarea
              value={descriptionDraft}
              aria-label="套件描述"
              data-my-assets-kit-description
              onChange={(event) => setDescriptionDraft(event.target.value)}
            />
            <div className={styles.editActions}>
              <button type="button" onClick={() => setEditingDescription(false)}>
                取消
              </button>
              <button
                type="button"
                className={styles.primary}
                disabled={busy}
                data-my-assets-kit-description-save
                onClick={() => void saveDescription()}
              >
                保存
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className={styles.description}
            onClick={() => setEditingDescription(true)}
          >
            {current?.guide || kit.description || '暂无描述'}
          </button>
        )}
      </section>

      <KitAssetsSection
        title="Logo"
        role="logo"
        items={logo}
        openMenu={openMenu}
        onUpload={() => chooseImage({ role: 'logo' })}
        onAdd={(item) => void addImageToAgent(item)}
        onMenu={(key) => setOpenMenu(key)}
        onReupload={(item) => chooseImage({ role: item.role, replace: item })}
        onDelete={(item) => void removeResource(item)}
      />

      <KitColorsSection
        colors={current?.colors ?? []}
        openMenu={openMenu}
        onMenu={setOpenMenu}
        onAdd={addColor}
        onUpdate={updateColor}
        onDelete={removeColor}
      />

      <KitFontsSection
        fonts={current?.fonts ?? []}
        fontLibrary={fontLibrary.fonts}
        openMenu={openMenu}
        onMenu={setOpenMenu}
        onAdd={(anchor) => chooseFont(anchor)}
        onEdit={(anchor, id) => chooseFont(anchor, id)}
        onUpload={(id) => {
          setFontReplaceId(id)
          setOpenMenu(null)
          fontInputRef.current?.click()
        }}
        onDelete={async (id) => {
          await saveVersion(
            { fonts: current?.fonts.filter((item) => item.id !== id) ?? [] },
            '字体已删除',
          )
        }}
      />

      <KitAssetsSection
        title="照片"
        role="reference"
        items={photos}
        openMenu={openMenu}
        onUpload={() => chooseImage({ role: 'reference' })}
        onAdd={(item) => void addImageToAgent(item)}
        onMenu={(key) => setOpenMenu(key)}
        onReupload={(item) => chooseImage({ role: item.role, replace: item })}
        onDelete={(item) => void removeResource(item)}
      />

      <p className={styles.status} aria-live="polite">{status}</p>
      <button
        type="button"
        className={styles.addAgent}
        data-my-assets-kit-detail-add
        onClick={() => void onAddKit()}
        disabled={!current}
      >
        添加到对话
      </button>

      {fontPicker ? (
        <KitFontPicker
          anchor={fontPicker.anchor}
          fonts={fontLibrary.fonts}
          selectedFontId={
            fontPicker.replaceId
              ? current?.fonts.find((font) => font.id === fontPicker.replaceId)?.fontId
              : undefined
          }
          onSelect={(font) => void selectFont(font)}
          onClose={() => setFontPicker(null)}
        />
      ) : null}
    </section>
  )
}
