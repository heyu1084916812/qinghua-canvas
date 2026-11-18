import { useEffect, useRef, useState } from 'react'
import { Icon, Settings2 } from '../../../ui/icon'
import type { ModelCapability } from '../../../domain/shared/capability'
import type { PresetModel, PresetVendor } from '../../../domain/project/modelPresets'
import { categoryLabel } from '../../../domain/project/modelSelection'
import { GLOBAL_MODEL_VENDORS } from '../settingsPageConstants'
import { ModelIcon } from '../../../features/shared/modelIcon/ModelIcon'
import { ChoicePicker } from '../../../features/shared/choicePicker/ChoicePicker'
import { settingsPageStyles as styles } from './settingsPageStyles'
import { SettingsModelCategoryTabs } from './SettingsModelCategoryTabs'

type MapSaveNotice = {
  id: string
  tone: 'ok' | 'error'
  text: string
}

type NewModelCategory = Exclude<PresetModel['category'], 'unknown'>
type MappingCategory = 'chat' | 'image' | 'video' | 'audio'

/** 映射分类固定四档（与模型能力对齐；`unknown` 只作为行内可选值，不单独成档） */
const MODEL_CATEGORY_ORDER = ['chat', 'image', 'video', 'audio'] as const
const MODEL_CATEGORY_LABELS: Record<MappingCategory, string> = {
  chat: '对话',
  image: '图片',
  video: '视频',
  audio: '音频',
}
const MODEL_CATEGORY_PANEL_ID = 'settings-model-category-panel'

const isMappingCategory = (
  category: PresetModel['category'],
): category is MappingCategory =>
  MODEL_CATEGORY_ORDER.some((item) => item === category)

export type SettingsChannelRouteViewProps = {
  allGlobalModels: PresetModel[]
  customModels: readonly { id: string }[]
  uncommonModelIds: readonly string[]
  activeModels: readonly ModelCapability[]
  modelAddOpen: boolean
  newModelName: string
  newModelCategory: PresetModel['category']
  newModelVendor: PresetVendor
  showUncommonModels: boolean
  modelMap: Record<string, string>
  mapSaveNotice: MapSaveNotice | null
  onModelAddOpenChange: (open: boolean) => void
  onNewModelNameChange: (name: string) => void
  onNewModelCategoryChange: (category: NewModelCategory) => void
  onNewModelVendorChange: (vendor: PresetVendor) => void
  onAddGlobalModel: () => void
  onShowUncommonModelsChange: (show: boolean) => void
  onBindModel: (upstreamId: string, logicalName: string) => void
  onModelUncommonChange: (id: string, uncommon: boolean) => void
  onRemoveGlobalModel: (id: string) => void
}

export function SettingsChannelRouteView({
  allGlobalModels,
  customModels,
  uncommonModelIds,
  activeModels,
  modelAddOpen,
  newModelName,
  newModelCategory,
  newModelVendor,
  showUncommonModels,
  modelMap,
  mapSaveNotice,
  onModelAddOpenChange,
  onNewModelNameChange,
  onNewModelCategoryChange,
  onNewModelVendorChange,
  onAddGlobalModel,
  onShowUncommonModelsChange,
  onBindModel,
  onModelUncommonChange,
  onRemoveGlobalModel,
}: SettingsChannelRouteViewProps) {
  const managerRef = useRef<HTMLElement | null>(null)
  const closeManagerRef = useRef(onModelAddOpenChange)
  closeManagerRef.current = onModelAddOpenChange
  const [activeCategory, setActiveCategory] = useState<MappingCategory | null>(null)
  const uncommon = new Set(uncommonModelIds)
  const rows = allGlobalModels
    .filter((preset) => {
      if (!isMappingCategory(preset.category)) return false
      return showUncommonModels || !uncommon.has(preset.id)
    })
    .map((preset) => {
      const upstream = modelMap[preset.id]?.trim() ?? ''
      const options = activeModels
        .filter(
          (model) =>
            model.category === 'unknown' || model.category === preset.category,
        )
        .map((model) => ({
          value: model.id,
          label: model.id,
          group: categoryLabel(model.category),
        }))
      options.unshift({
        value: '',
        label: '未映射',
        group: '映射状态',
      })
      if (upstream && !options.some((option) => option.value === upstream)) {
        options.splice(1, 0, {
          value: upstream,
          label: `${upstream}（当前值）`,
          group: '当前映射',
        })
      }
      return {
        preset,
        upstream,
        options,
        isUncommon: uncommon.has(preset.id),
      }
    })
  const groups = MODEL_CATEGORY_ORDER.map((category) => ({
    category,
    label: MODEL_CATEGORY_LABELS[category],
    rows: rows.filter((row) => row.preset.category === category),
  }))
  const activeGroup =
    groups.find((group) => group.category === activeCategory) ??
    groups.find((group) => group.rows.length > 0) ??
    groups[0]
  const activeRows = activeGroup?.rows ?? []

  useEffect(() => {
    if (!modelAddOpen) return
    const previous = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const input = managerRef.current?.querySelector<HTMLInputElement>('[data-global-model-name]')
    input?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      const picker = event.target instanceof Element ? event.target.closest('[data-choice-picker]') : null
      if (picker?.querySelector('[role="listbox"]')) return
      event.preventDefault()
      closeManagerRef.current(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previous?.focus()
    }
  }, [modelAddOpen])

  return (
    <section className={styles.editorSection} data-settings-channel-route>
      <div className={`${styles.modelsHead} ${styles.modelMappingHead}`}>
        <span className={styles.cardTitle}>模型映射</span>
        <button
          type="button"
          className={
            modelAddOpen
              ? `${styles.ghostBtn} ${styles.modelsManageButton} ${styles.modelsManageButtonOn}`
              : `${styles.ghostBtn} ${styles.modelsManageButton}`
          }
          data-global-model-add-toggle
          aria-label="管理前端模型"
          aria-expanded={modelAddOpen}
          aria-controls="settings-global-model-dialog"
          title="管理前端模型"
          onClick={() => onModelAddOpenChange(!modelAddOpen)}
        >
          <Icon icon={Settings2} size="md" />
        </button>
      </div>

      {modelAddOpen && (
        <div className={styles.modelManagerLayer}>
          <button
            type="button"
            className={styles.modelManagerBackdrop}
            aria-label="关闭前端模型目录"
            onClick={() => onModelAddOpenChange(false)}
          />
          <section
            id="settings-global-model-dialog"
            ref={managerRef}
            className={styles.modelManagerPanel}
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-global-model-title"
          >
            <div className={styles.modelManagerHead}>
              <div className={styles.modelAddFormHead}>
                <span className={styles.label} id="settings-global-model-title">
                  前端模型目录
                </span>
                <span className={styles.cardSub}>全局模型，在各分组之间共享</span>
              </div>
              <button
                type="button"
                className={styles.ghostBtn}
                data-global-model-close
                onClick={() => onModelAddOpenChange(false)}
              >
                完成
              </button>
            </div>
            <div
              className={`${styles.modelAddForm} ${styles.modelManagerForm}`}
              data-global-model-form
            >
              <div className={styles.fieldRow}>
                <label className={`${styles.field} ${styles.grow}`}>
                  <span className={styles.label}>显示名称</span>
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
                      onNewModelCategoryChange(value as NewModelCategory)
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
              {customModels.length > 0 ? (
                <div className={styles.customModelList}>
                  {customModels.map((model) => (
                    <span key={model.id} className={styles.customModelChip}>
                      {model.id}
                      <button
                        type="button"
                        aria-label={`删除前端模型 ${model.id}`}
                        data-global-model-remove={model.id}
                        onClick={() => onRemoveGlobalModel(model.id)}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
              <div className={styles.modelAddActions}>
                <button
                  className={styles.ghostBtn}
                  data-global-model-close
                  onClick={() => onModelAddOpenChange(false)}
                >
                  取消
                </button>
                <button
                  className={styles.primary}
                  data-global-model-add
                  disabled={!newModelName.trim()}
                  onClick={onAddGlobalModel}
                >
                  添加
                </button>
              </div>
            </div>
          </section>
        </div>
      )}

      <div className={styles.modelCategoryControls}>
        <SettingsModelCategoryTabs
          tabs={groups.map((group) => ({
            category: group.category,
            label: group.label,
            count: group.rows.length,
          }))}
          activeCategory={activeGroup.category}
          onChange={(category) => {
            if (isMappingCategory(category)) setActiveCategory(category)
          }}
        />
        <label className={styles.showUncommonToggle}>
          <input
            type="checkbox"
            checked={showUncommonModels}
            data-route-map-show-uncommon
            onChange={(event) => onShowUncommonModelsChange(event.target.checked)}
          />
          <span>显示不常用模型</span>
        </label>
      </div>

      {activeRows.length > 0 ? (
        <div
          className={styles.mappingTable}
          data-route-map-table
          id={MODEL_CATEGORY_PANEL_ID}
          role="tabpanel"
          aria-labelledby={`settings-model-category-tab-${activeGroup.category}`}
        >
          <div className={styles.mappingTableHead} aria-hidden>
            <span>前端显示模型</span>
            <span>真实模型</span>
            <span>常用设置</span>
          </div>
          {activeRows.map(({ preset, upstream, options, isUncommon }) => {
                const save = mapSaveNotice?.id === preset.id ? mapSaveNotice : null
                return (
                  <div key={preset.id} className={styles.mappingRow} data-route-map-row={preset.id} data-route-map-category={preset.category}>
                    <div className={styles.mappingFrontendModel} title={preset.id} data-route-map-frontend={preset.id}>
                      <ModelIcon vendor={preset.vendor} size={18} />
                      <b data-route-map-label>{preset.id}</b>
                    </div>
                    <div className={styles.mappingRealModel} data-route-map-real={preset.id}>
                      <ChoicePicker
                        name={`mapping-${preset.id}`}
                        value={upstream}
                        ariaLabel={`${preset.id} 对应的真实模型`}
                        placeholder="未映射"
                        onChange={(value) => onBindModel(value, preset.id)}
                        options={options}
                      />
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={!isUncommon}
                      aria-label={`${preset.id} · 常用模型`}
                      className={
                        !isUncommon
                          ? styles.globalCommonButton
                          : `${styles.globalCommonButton} ${styles.globalCommonButtonOff}`
                      }
                      data-route-map-uncommon={preset.id}
                      title="全局设置，影响所有分组和前端模型选择"
                      onClick={() => onModelUncommonChange(preset.id, !isUncommon)}
                    >
                      <span className={styles.globalCommonSwitch} aria-hidden />
                      <span>{isUncommon ? '不常用' : '常用'}</span>
                    </button>
                    {save?.tone === 'error' ? (
                      <p className={styles.mappingInlineError} role="alert">
                        {save.text}
                      </p>
                    ) : null}
                  </div>
                )
          })}
        </div>
      ) : null}
    </section>
  )
}
