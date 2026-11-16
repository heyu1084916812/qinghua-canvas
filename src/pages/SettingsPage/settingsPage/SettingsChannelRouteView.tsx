import { useEffect, useRef } from 'react'
import type { ModelCapability } from '../../../domain/shared/capability'
import type { PresetModel, PresetVendor } from '../../../domain/project/modelPresets'
import { categoryLabel } from '../../../domain/project/modelSelection'
import { GLOBAL_MODEL_VENDORS } from '../settingsPageConstants'
import { ModelIcon } from '../../../features/shared/modelIcon/ModelIcon'
import { ChoicePicker } from '../../../features/shared/choicePicker/ChoicePicker'
import { settingsPageStyles as styles } from './settingsPageStyles'

type MapSaveNotice = {
  id: string
  tone: 'ok' | 'error'
  text: string
}

type NewModelCategory = Exclude<PresetModel['category'], 'unknown'>

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
  const uncommon = new Set(uncommonModelIds)
  const activeCategories = new Set(activeModels.map((model) => model.category))
  const rows = allGlobalModels
    .filter((preset) => {
      const upstream = modelMap[preset.id]?.trim()
      const relevantToGroup =
        Boolean(upstream) ||
        activeCategories.has('unknown') ||
        activeCategories.has(preset.category)
      return relevantToGroup && (showUncommonModels || !uncommon.has(preset.id))
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

  useEffect(() => {
    if (!modelAddOpen) return
    const previous = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const input = managerRef.current?.querySelector<HTMLInputElement>(
      '[data-global-model-name]',
    )
    input?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      const picker =
        event.target instanceof Element
          ? event.target.closest('[data-choice-picker]')
          : null
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
      <div className={styles.modelsHead}>
        <div className={styles.modelsTitleBox}>
          <span className={styles.cardTitle}>模型映射</span>
          <span className={styles.cardSub}>
            将当前分组的真实模型绑定到画布使用的全局前端模型
          </span>
        </div>
        <button
          className={styles.ghostBtn}
          data-global-model-add-toggle
          onClick={() => onModelAddOpenChange(!modelAddOpen)}
        >
          {modelAddOpen ? '收起管理' : '管理前端模型'}
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

      <div className={styles.mapToolbar}>
        <span className={styles.cardSub}>
          {rows.length > 0
            ? `${rows.filter((row) => row.upstream).length}/${rows.length} 个前端模型已绑定真实模型`
            : '前端模型目录为空'}
        </span>
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

      {rows.length === 0 ? (
        <p className={styles.modelsEmpty} data-route-map-empty>
          先在上方选择当前分组可用的真实模型，再回来绑定前端模型。
        </p>
      ) : (
        <div className={styles.mappingTable} data-route-map-table>
          <div className={styles.mappingTableHead} aria-hidden>
            <span>前端显示模型</span>
            <span>真实模型</span>
            <span>常用状态</span>
          </div>
          {rows.map(({ preset, upstream, options, isUncommon }) => {
            const save = mapSaveNotice?.id === preset.id ? mapSaveNotice : null
            return (
              <div
                key={preset.id}
                className={styles.mappingRow}
                data-route-map-row={preset.id}
                data-route-map-category={preset.category}
              >
                <div
                  className={styles.mappingFrontendModel}
                  title={preset.id}
                  data-route-map-frontend={preset.id}
                >
                  <ModelIcon vendor={preset.vendor} size={18} />
                  <span>
                    <b data-route-map-label>{preset.id}</b>
                    <small>{categoryLabel(preset.category)}</small>
                  </span>
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
                  className={
                    !isUncommon
                      ? styles.globalCommonButton
                      : `${styles.globalCommonButton} ${styles.globalCommonButtonOff}`
                  }
                  data-route-map-uncommon={preset.id}
                  title="全局设置，影响所有分组和前端模型选择"
                  onClick={() => onModelUncommonChange(preset.id, !isUncommon)}
                >
                  <span aria-hidden />
                  {isUncommon ? '不常用 · 全局' : '常用 · 全局'}
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
      )}
    </section>
  )
}
