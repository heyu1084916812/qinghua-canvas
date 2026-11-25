import { useState } from 'react'
import { Icon, Settings2 } from '../../../ui/icon'
import type { ModelCapability } from '../../../domain/shared/capability'
import {
  presetDisplayName,
  type PresetModel,
  type PresetVendor,
} from '../../../domain/project/modelPresets'
import { categoryLabel } from '../../../domain/project/modelSelection'
import { ModelIcon } from '../../../features/shared/modelIcon/ModelIcon'
import { ChoicePicker } from '../../../features/shared/choicePicker/ChoicePicker'
import { settingsPageStyles as styles } from './settingsPageStyles'
import { SettingsGlobalModelManager } from './SettingsGlobalModelManager'
import { SettingsModelCategoryTabs } from './SettingsModelCategoryTabs'
import { useMappingTabAnchor } from './useMappingTabAnchor'
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
  scrollScope?: string
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
  onRenameGlobalModel: (id: string, nextLabel: string) => void
}

export function SettingsChannelRouteView({
  scrollScope,
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
  onRenameGlobalModel,
}: SettingsChannelRouteViewProps) {
  const [activeCategory, setActiveCategory] = useState<MappingCategory | null>(null)
  const uncommon = new Set(uncommonModelIds)
  const catalogGroups = MODEL_CATEGORY_ORDER.map((category) => ({
    category,
    label: MODEL_CATEGORY_LABELS[category],
    models: allGlobalModels.filter((model) => model.category === category),
  }))
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
  const { sectionRef, capture } = useMappingTabAnchor(activeGroup.category, scrollScope)

  return (
    <section ref={sectionRef} className={`${styles.editorSection} ${styles.mappingSection}`} data-settings-channel-route>
      {/* 标签栏贴在表格面板顶边、背后是页面底色：和 Key 分组同一套三段式（标题 / 标签 / 面板） */}
      <div className={styles.mappingTabsRow}>
        <SettingsModelCategoryTabs
          tabs={groups.map((group) => ({
            category: group.category,
            label: group.label,
            count: group.rows.length,
          }))}
          activeCategory={activeGroup.category}
          onChange={(category) => {
            if (!isMappingCategory(category)) return
            if (category !== activeGroup.category) capture()
            setActiveCategory(category)
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

      <div className={styles.mappingPanel}>
      <div className={`${styles.modelsHead} ${styles.modelMappingHead} ${styles.mappingHead}`}>
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

      <SettingsGlobalModelManager
        open={modelAddOpen}
        groups={catalogGroups}
        activeCategory={activeGroup.category}
        customModels={customModels}
        newModelName={newModelName}
        newModelCategory={newModelCategory}
        newModelVendor={newModelVendor}
        onClose={() => onModelAddOpenChange(false)}
        onNewModelNameChange={onNewModelNameChange}
        onNewModelCategoryChange={onNewModelCategoryChange}
        onNewModelVendorChange={onNewModelVendorChange}
        onAddGlobalModel={onAddGlobalModel}
        onRemoveGlobalModel={onRemoveGlobalModel}
        onRenameGlobalModel={onRenameGlobalModel}
      />
      {/* 面板始终渲染 + 行区固定高度（行数不同也不跳）；但一条都没有时塌成一行提示，不留空长表 */}
      <div
        className={`${styles.mappingTable} ${styles.mappingPanel}${activeRows.length === 0 ? ` ${styles.mappingPanelEmpty}` : ''}`}
        data-route-map-table
        id={MODEL_CATEGORY_PANEL_ID}
        role="tabpanel"
        aria-labelledby={`settings-model-category-tab-${activeGroup.category}`}
      >
        {activeRows.length > 0 ? (
          <div className={styles.mappingTableHead} aria-hidden>
            <span>前端显示模型</span>
            <span>真实模型</span>
            <span>常用设置</span>
          </div>
        ) : null}
        <div
          className={`${styles.mappingRows}${activeRows.length === 0 ? ` ${styles.mappingRowsEmpty}` : ''}`}
          data-route-map-rows
        >
          {activeRows.length === 0 ? (
            <p className={styles.mappingEmptyHint} data-route-map-category-empty>这一类还没有前端模型</p>
          ) : null}
          {activeRows.map(({ preset, upstream, options, isUncommon }) => {
                const save = mapSaveNotice?.id === preset.id ? mapSaveNotice : null
                return (
                  <div key={preset.id} className={styles.mappingRow} data-route-map-row={preset.id} data-route-map-category={preset.category}>
                    <div className={styles.mappingFrontendModel} title={presetDisplayName(preset)} data-route-map-frontend={preset.id}>
                      <ModelIcon vendor={preset.vendor} size={18} />
                      <b data-route-map-label>{presetDisplayName(preset)}</b>
                    </div>
                    <div className={styles.mappingRealModel} data-route-map-real={preset.id}>
                      <ChoicePicker
                        name={`mapping-${preset.id}`}
                        value={upstream}
                        ariaLabel={`${presetDisplayName(preset)} 对应的真实模型`}
                        placeholder="未映射"
                        onChange={(value) => onBindModel(value, preset.id)}
                        options={options}
                      />
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={!isUncommon}
                      aria-label={`${presetDisplayName(preset)} · 常用模型`}
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
      </div>
      </div>
    </section>
  )
}
