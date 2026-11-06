import {
  categoryLabel,
  routeMapOptions,
} from '../../../domain/project/modelSelection'
import type { ModelCapability } from '../../../domain/shared/capability'
import type { PresetModel, PresetVendor } from '../../../domain/project/modelPresets'
import {
  GLOBAL_MODEL_VENDORS,
  MAP_FILTERS,
  type MapFilterKey,
} from '../settingsPageConstants'
import { ModelIcon } from '../../../features/shared/modelIcon/ModelIcon'
import { ModelMapCombo } from '../SettingsPicker'
import { settingsPageStyles as styles } from './settingsPageStyles'

type MapTest = {
  status: 'checking' | 'ok' | 'missing' | 'error'
  message: string
}

type MapSaveNotice = {
  id: string
  tone: 'ok' | 'error'
  text: string
}

type NewModelCategory = Exclude<PresetModel['category'], 'unknown'>

export type SettingsChannelRouteViewProps = {
  priority: number
  weight: number
  allGlobalModels: PresetModel[]
  customModels: readonly { id: string }[]
  uncommonModelIds: readonly string[]
  activeModels: readonly ModelCapability[]
  activeModelCache: readonly ModelCapability[]
  modelAddOpen: boolean
  newModelName: string
  newModelCategory: PresetModel['category']
  newModelVendor: PresetVendor
  showUncommonModels: boolean
  mapCategory: MapFilterKey
  modelMap: Record<string, string>
  mapDrafts: Record<string, string>
  mapSaveNotice: MapSaveNotice | null
  mapTests: Record<string, MapTest>
  onPriorityChange: (value: number) => void
  onWeightChange: (value: number) => void
  onModelAddOpenChange: (open: boolean) => void
  onNewModelNameChange: (name: string) => void
  onNewModelCategoryChange: (category: NewModelCategory) => void
  onNewModelVendorChange: (vendor: PresetVendor) => void
  onAddGlobalModel: () => void
  onMapCategoryChange: (category: MapFilterKey) => void
  onShowUncommonModelsChange: (show: boolean) => void
  onDraftChange: (id: string, value: string) => void
  onScheduleModelMapping: (id: string, value: string) => void
  onFlushModelMapping: (id: string, value: string) => void
  onTestModelMapping: (id: string, value: string) => void
  onModelUncommonChange: (id: string, uncommon: boolean) => void
  onRemoveGlobalModel: (id: string) => void
}

export function SettingsChannelRouteView({
  priority,
  weight,
  allGlobalModels,
  customModels,
  uncommonModelIds,
  activeModels,
  activeModelCache,
  modelAddOpen,
  newModelName,
  newModelCategory,
  newModelVendor,
  showUncommonModels,
  mapCategory,
  modelMap,
  mapDrafts,
  mapSaveNotice,
  mapTests,
  onPriorityChange,
  onWeightChange,
  onModelAddOpenChange,
  onNewModelNameChange,
  onNewModelCategoryChange,
  onNewModelVendorChange,
  onAddGlobalModel,
  onMapCategoryChange,
  onShowUncommonModelsChange,
  onDraftChange,
  onScheduleModelMapping,
  onFlushModelMapping,
  onTestModelMapping,
  onModelUncommonChange,
  onRemoveGlobalModel,
}: SettingsChannelRouteViewProps) {
  const presetIds = allGlobalModels.map((model) => model.id)
  const rows = allGlobalModels.map((model) => ({
    key: model.id,
    label: model.id,
    category: model.category,
    vendor: model.vendor,
  }))
  const uncommon = new Set(uncommonModelIds)
  const allGroupRows = rows.filter((row) => String(row.category) === mapCategory)
  const groupRows = allGroupRows.filter(
    (row) => showUncommonModels || !uncommon.has(row.key),
  )
  const options = routeMapOptions(
    mapCategory,
    activeModels,
    activeModelCache,
  )

  return (
    <section className={styles.editorSection} data-settings-channel-route>
      <div className={styles.modelsHead}>
        <div className={styles.modelsTitleBox}>
          <span className={styles.cardTitle}>渠道权重与模型映射</span>
          <span className={styles.cardSub}>仅作用于当前渠道。</span>
        </div>
      </div>

      <div className={styles.fieldRow}>
        <label className={styles.field}>
          <span className={styles.label}>优先度（越大越先）</span>
          <input
            className={`${styles.input} ${styles.numInput}`}
            type="number"
            data-route-priority
            value={priority}
            onChange={(event) => onPriorityChange(Number(event.target.value))}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>权重（同档均摊）</span>
          <input
            className={`${styles.input} ${styles.numInput}`}
            type="number"
            min={0}
            data-route-weight
            value={weight}
            onChange={(event) => onWeightChange(Number(event.target.value))}
          />
        </label>
      </div>

      <div className={styles.mapHead}>
        <span className={styles.label}>模型映射（前端显示名 → 本站点真实 ID）</span>
        <button
          className={styles.ghostBtn}
          data-global-model-add-toggle
          onClick={() => onModelAddOpenChange(!modelAddOpen)}
        >
          {modelAddOpen ? '收起' : '+ 添加前端模型'}
        </button>
      </div>

      {modelAddOpen && (
        <div className={styles.modelAddForm} data-global-model-form>
          <label className={styles.field}>
            <span className={styles.label}>前端显示名</span>
            <input
              className={styles.input}
              data-global-model-name
              value={newModelName}
              placeholder="例如：My Image Pro"
              onChange={(event) => onNewModelNameChange(event.target.value)}
            />
          </label>
          <div className={styles.modelAddRow}>
            <span className={styles.label}>分类</span>
            <div className={styles.mapFilters}>
              {(['image', 'chat', 'video', 'audio'] as const).map((category) => (
                <button
                  key={category}
                  type="button"
                  className={
                    newModelCategory === category
                      ? `${styles.mapFilter} ${styles.mapFilterOn}`
                      : styles.mapFilter
                  }
                  data-global-model-category={category}
                  onClick={() => onNewModelCategoryChange(category)}
                >
                  {categoryLabel(category)}
                </button>
              ))}
            </div>
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
            <button className={styles.ghostBtn} onClick={() => onModelAddOpenChange(false)}>
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
      )}

      <div className={styles.mapToolbar}>
        <div className={styles.mapFilters} role="tablist" aria-label="模型映射分类">
          {MAP_FILTERS.map((filter) => (
            <button
              key={filter.key}
              type="button"
              role="tab"
              aria-selected={mapCategory === filter.key}
              data-route-map-filter={filter.key}
              className={
                mapCategory === filter.key
                  ? `${styles.mapFilter} ${styles.mapFilterOn}`
                  : styles.mapFilter
              }
              onClick={() => onMapCategoryChange(filter.key)}
            >
              {filter.title}
            </button>
          ))}
        </div>
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

      {groupRows.length === 0 ? (
        <p className={styles.modelsEmpty} data-route-map-empty={mapCategory}>
          {allGroupRows.length > 0
            ? '这一类的模型都已标为不常用。勾选“显示不常用模型”可恢复为常用。'
            : '这一类的模型列表目前为空。'}
        </p>
      ) : (
        <div className={styles.mapGroup} data-route-map-group={mapCategory}>
          <div className={styles.mapList}>
            {groupRows.map(({ key: id, label, vendor }) => {
              const saved = modelMap[id] ?? ''
              const draft = mapDrafts[id]
              const value = draft ?? saved
              const isPreset = presetIds.includes(id)
              const isUncommon = uncommonModelIds.includes(id)
              const test = mapTests[id]
              return (
                <div
                  key={id}
                  className={styles.mapRow}
                  data-route-map-row={id}
                  data-route-map-preset={isPreset ? '1' : '0'}
                >
                  <span className={styles.mapName} title={id} data-route-map-label>
                    <ModelIcon vendor={vendor} size={19} />
                    <span className={styles.mapLabelText}>{label}</span>
                  </span>
                  <ModelMapCombo
                    rowId={id}
                    category={mapCategory}
                    value={value}
                    options={options}
                    placeholder="留空 = 按原名发送"
                    emptyHint="该渠道还没勾选同类模型"
                    ariaLabel={`${MAP_FILTERS.find((filter) => filter.key === mapCategory)?.title ?? ''} ${label} 对应的本站模型 ID`}
                    onChange={(next) => {
                      onDraftChange(id, next)
                      onScheduleModelMapping(id, next)
                    }}
                    onBlur={() => onFlushModelMapping(id, value)}
                  />
                  <span
                    className={
                      mapSaveNotice?.tone === 'error'
                        ? `${styles.mapSaveState} ${styles.mapSaveError}`
                        : styles.mapSaveState
                    }
                    data-route-map-save-state={
                      mapSaveNotice?.id === id ? mapSaveNotice.tone : undefined
                    }
                    aria-live="polite"
                  >
                    {mapSaveNotice?.id === id ? mapSaveNotice.text : ''}
                  </span>
                  <label
                    className={styles.mapUncommonToggle}
                    title="勾选后从画布、Agent、默认参数和电商模型中隐藏"
                  >
                    <input
                      type="checkbox"
                      checked={isUncommon}
                      data-route-map-uncommon={id}
                      onChange={(event) =>
                        onModelUncommonChange(id, event.target.checked)
                      }
                    />
                    <span>不常用</span>
                  </label>
                  <button
                    type="button"
                    className={styles.mapTestButton}
                    data-route-map-test={id}
                    disabled={test?.status === 'checking'}
                    onClick={() => onTestModelMapping(id, value)}
                  >
                    {test?.status === 'checking' ? '测试中' : '测试'}
                  </button>
                  {customModels.some((model) => model.id === id) && (
                    <button
                      className={styles.chipX}
                      aria-label={`删除前端模型 ${id}`}
                      data-global-model-remove={id}
                      onClick={() => onRemoveGlobalModel(id)}
                    >
                      ×
                    </button>
                  )}
                  <span
                    className={
                      test?.status === 'ok'
                        ? `${styles.mapTestState} ${styles.mapTestOk}`
                        : test?.status === 'missing'
                          ? `${styles.mapTestState} ${styles.mapTestMissing}`
                          : test?.status === 'error'
                            ? `${styles.mapTestState} ${styles.mapTestError}`
                            : styles.mapTestState
                    }
                    data-route-map-test-state={test?.status}
                    aria-live="polite"
                  >
                    {test?.message ?? ''}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}
