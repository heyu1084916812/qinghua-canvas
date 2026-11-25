import { useEffect, useRef, useState } from 'react'
import {
  presetDisplayName,
  type PresetModel,
  type PresetVendor,
} from '../../../domain/project/modelPresets'
import { categoryLabel } from '../../../domain/project/modelSelection'
import { ChoicePicker } from '../../../features/shared/choicePicker/ChoicePicker'
import { ModelIcon } from '../../../features/shared/modelIcon/ModelIcon'
import { Icon, Plus, X } from '../../../ui/icon'
import { GLOBAL_MODEL_VENDORS } from '../settingsPageConstants'
import { settingsPageStyles as styles } from './settingsPageStyles'

export type GlobalModelCatalogGroup = {
  category: PresetModel['category']
  label: string
  models: readonly PresetModel[]
}

export type SettingsGlobalModelManagerProps = {
  open: boolean
  groups: readonly GlobalModelCatalogGroup[]
  activeCategory: PresetModel['category']
  customModels: readonly { id: string }[]
  formOpen: boolean
  newModelName: string
  newModelCategory: PresetModel['category']
  newModelVendor: PresetVendor
  onClose: () => void
  onFormOpenChange: (open: boolean) => void
  onNewModelNameChange: (name: string) => void
  onNewModelCategoryChange: (category: PresetModel['category']) => void
  onNewModelVendorChange: (vendor: PresetVendor) => void
  onAddGlobalModel: () => void
  onRemoveGlobalModel: (id: string) => void
  onRenameGlobalModel: (id: string, nextLabel: string) => void
}

/**
 * 全局前端模型目录。
 *
 * 模型映射行只回答「当前渠道怎么翻译」；新增、常用状态和删除都影响所有渠道，
 * 因此统一收在这张目录弹窗里。内置模型来自代码目录，只能切常用，不能在这里
 * 伪装成可删除的数据行。
 */
export function SettingsGlobalModelManager({
  open,
  groups,
  activeCategory,
  customModels,
  formOpen,
  newModelName,
  newModelCategory,
  newModelVendor,
  onClose,
  onFormOpenChange,
  onNewModelNameChange,
  onNewModelCategoryChange,
  onNewModelVendorChange,
  onAddGlobalModel,
  onRemoveGlobalModel,
  onRenameGlobalModel,
}: SettingsGlobalModelManagerProps) {
  const panelRef = useRef<HTMLElement | null>(null)
  const cancelRenameRef = useRef(false)
  const closeRef = useRef(onClose)
  const formOpenRef = useRef(formOpen)
  const formOpenChangeRef = useRef(onFormOpenChange)
  closeRef.current = onClose
  formOpenRef.current = formOpen
  formOpenChangeRef.current = onFormOpenChange
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [catalogCategory, setCatalogCategory] = useState(activeCategory)

  useEffect(() => {
    if (!open || typeof document === 'undefined') return
    const previous = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      const picker = event.target instanceof Element
        ? event.target.closest('[data-choice-picker]')
        : null
      if (picker?.querySelector('[role="listbox"]')) return
      event.preventDefault()
      if (formOpenRef.current) formOpenChangeRef.current(false)
      else closeRef.current()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previous?.focus()
    }
  }, [open])

  useEffect(() => {
    if (!open || !formOpen || typeof document === 'undefined') return
    panelRef.current
      ?.querySelector<HTMLInputElement>('[data-global-model-name]')
      ?.focus()
  }, [formOpen, open])

  useEffect(() => {
    if (
      !open ||
      !editingId ||
      typeof document === 'undefined' ||
      typeof CSS === 'undefined'
    ) return
    const input = panelRef.current?.querySelector<HTMLInputElement>(
      `[data-global-model-rename-input="${CSS.escape(editingId)}"]`,
    )
    input?.focus()
    input?.select()
  }, [editingId, open])

  useEffect(() => {
    if (!open) return
    setCatalogCategory(activeCategory)
    onNewModelCategoryChange(activeCategory)
  }, [activeCategory, onNewModelCategoryChange, open])

  if (!open) return null

  const customIds = new Set(customModels.map((model) => model.id))
  const activeGroup =
    groups.find((group) => group.category === catalogCategory) ?? groups[0]

  const beginRename = (model: PresetModel) => {
    if (!customIds.has(model.id)) return
    cancelRenameRef.current = false
    setEditingId(model.id)
    setEditingName(presetDisplayName(model))
  }

  const toggleCreate = () => {
    if (!formOpen) onNewModelCategoryChange(activeCategory)
    onFormOpenChange(!formOpen)
  }

  const cancelRename = () => {
    cancelRenameRef.current = true
    setEditingId(null)
    setEditingName('')
  }

  const commitRename = (model: PresetModel) => {
    if (cancelRenameRef.current) {
      cancelRenameRef.current = false
      return
    }
    const next = editingName.trim()
    setEditingId(null)
    setEditingName('')
    if (!next || next === presetDisplayName(model)) return
    onRenameGlobalModel(model.id, next)
  }

  return (
    <div className={styles.modelManagerLayer}>
      <button
        type="button"
        className={styles.modelManagerBackdrop}
        aria-label="关闭前端模型目录"
        onClick={onClose}
      />
      <section
        id="settings-global-model-dialog"
        ref={panelRef}
        className={styles.modelManagerPanel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-global-model-title"
        data-global-model-catalog
      >
        <div className={styles.modelManagerHead}>
          <div className={styles.modelAddFormHead}>
            <span className={styles.label} id="settings-global-model-title">
              前端模型目录
            </span>
            <span className={styles.cardSub}>全局模型，在各分组之间共享</span>
          </div>
          <div className={styles.modelManagerActions}>
            <button
              type="button"
              className={styles.ghostBtn}
              data-global-model-create-toggle
              aria-expanded={formOpen}
              aria-controls="settings-global-model-form"
              onClick={toggleCreate}
            >
              <Icon icon={formOpen ? X : Plus} size="sm" />
              {formOpen ? '收起新增' : '新增模型'}
            </button>
            <button
              type="button"
              className={styles.ghostBtn}
              data-global-model-close
              onClick={onClose}
            >
              完成
            </button>
          </div>
        </div>

        {formOpen ? (
          <div
            id="settings-global-model-form"
            className={`${styles.modelAddForm} ${styles.modelManagerForm}`}
            data-global-model-form
          >
            <div className={styles.fieldRow}>
              <label className={`${styles.field} ${styles.grow}`}>
                <span className={styles.label}>前端模型名称</span>
                <input
                  className={styles.input}
                  data-global-model-name
                  value={newModelName}
                  placeholder="例如：My Image Pro"
                  onChange={(event) => onNewModelNameChange(event.target.value)}
                />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>分类</span>
                <ChoicePicker
                  name="new-global-model-category"
                  value={newModelCategory}
                  ariaLabel="前端模型分类"
                  options={(['image', 'chat', 'video', 'audio'] as const).map(
                    (category) => ({
                      value: category,
                      label: categoryLabel(category),
                    }),
                  )}
                  onChange={(value) =>
                    onNewModelCategoryChange(value as PresetModel['category'])
                  }
                />
              </label>
            </div>
            <div className={styles.modelAddRow}>
              <span className={styles.label}>图标</span>
              <div className={styles.vendorGrid}>
                {GLOBAL_MODEL_VENDORS.map((vendor) => (
                  <button
                    key={vendor.value}
                    type="button"
                    className={
                      newModelVendor === vendor.value
                        ? `${styles.vendorOption} ${styles.vendorOptionOn}`
                        : styles.vendorOption
                    }
                    data-global-model-vendor={vendor.value}
                    onClick={() => onNewModelVendorChange(vendor.value)}
                  >
                    <ModelIcon vendor={vendor.value} size={18} />
                    <span>{vendor.label}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className={styles.modelAddActions}>
              <button
                type="button"
                className={styles.ghostBtn}
                data-global-model-form-cancel
                onClick={() => onFormOpenChange(false)}
              >
                取消
              </button>
              <button
                type="button"
                className={styles.primary}
                data-global-model-add
                disabled={!newModelName.trim()}
                onClick={onAddGlobalModel}
              >
                添加
              </button>
            </div>
          </div>
        ) : null}

        <div className={styles.globalModelCatalog}>
          <div className={styles.globalModelCatalogHead}>
            <span className={styles.cardTitle}>已有前端模型</span>
            <span className={styles.cardSub}>
              前端模型名称 · 内置模型不可删除，自定义模型可删除
            </span>
          </div>
          <div
            className={styles.globalModelCategoryTabs}
            role="tablist"
            aria-label="已有前端模型分类"
            data-global-model-category-tabs
          >
            {groups.map((group) => {
              const selected = group.category === activeGroup?.category
              return (
                <button
                  key={group.category}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  tabIndex={selected ? 0 : -1}
                  className={
                    selected
                      ? `${styles.globalModelCategoryTab} ${styles.globalModelCategoryTabOn}`
                      : styles.globalModelCategoryTab
                  }
                  data-global-model-category-tab={group.category}
                  onClick={() => setCatalogCategory(group.category)}
                >
                  {group.label}
                  <span className={styles.mappingFilterCount}>{group.models.length}</span>
                </button>
              )
            })}
          </div>
          <div className={styles.globalModelCatalogScroll}>
            {activeGroup ? (
              <section
                key={activeGroup.category}
                className={styles.globalModelGroup}
                data-global-model-group={activeGroup.category}
                role="tabpanel"
                aria-label={activeGroup.label}
              >
                <div
                  className={styles.globalModelStack}
                  data-global-model-stack={activeGroup.category}
                >
                  {activeGroup.models.length === 0 ? (
                    <p className={styles.globalModelEmpty}>这一分类还没有前端模型</p>
                  ) : (
                    activeGroup.models.map((model) => {
                      const custom = customIds.has(model.id)
                      const displayName = presetDisplayName(model)
                      return (
                        <div
                          key={model.id}
                          className={styles.globalModelChip}
                          data-global-model-row={model.id}
                          data-global-model-kind={custom ? 'custom' : 'builtin'}
                        >
                          <span className={styles.globalModelIdentity}>
                            <ModelIcon vendor={model.vendor} size={18} />
                            {editingId === model.id ? (
                              <input
                                className={styles.globalModelRenameInput}
                                data-global-model-rename-input={model.id}
                                aria-label={`重命名前端模型 ${displayName}`}
                                value={editingName}
                                onChange={(event) => setEditingName(event.target.value)}
                                onBlur={() => commitRename(model)}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') {
                                    event.preventDefault()
                                    event.currentTarget.blur()
                                  } else if (event.key === 'Escape') {
                                    event.preventDefault()
                                    event.stopPropagation()
                                    cancelRename()
                                  }
                                }}
                              />
                            ) : custom ? (
                              <button
                                type="button"
                                className={styles.globalModelNameButton}
                                data-global-model-rename-trigger={model.id}
                                title="双击重命名"
                                onDoubleClick={() => beginRename(model)}
                                onKeyDown={(event) => {
                                  if (event.key !== 'F2' && event.key !== 'Enter') return
                                  event.preventDefault()
                                  beginRename(model)
                                }}
                              >
                                {displayName}
                              </button>
                            ) : (
                              <span className={styles.globalModelName} title={displayName}>
                                {displayName}
                              </span>
                            )}
                          </span>
                          {custom ? (
                            <button
                              type="button"
                              className={styles.globalModelDelete}
                              aria-label={`删除前端模型 ${displayName}`}
                              title="删除前端模型"
                              data-global-model-remove={model.id}
                              onClick={() => onRemoveGlobalModel(model.id)}
                            >
                              <Icon icon={X} size="sm" />
                            </button>
                          ) : null}
                        </div>
                      )
                    })
                  )}
                </div>
              </section>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  )
}
