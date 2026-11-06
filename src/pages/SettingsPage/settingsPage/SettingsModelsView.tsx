import { CATEGORY_FILTERS, type CategoryFilter } from '../../../domain/project/modelSelection'
import type { ChannelCredentialGroup } from '../../../domain/project/channel'
import type { ModelCapability } from '../../../domain/shared/capability'
import { ChoicePicker } from '../../../features/shared/choicePicker/ChoicePicker'
import { settingsPageStyles as styles } from './settingsPageStyles'

type SelectedModelGroup = {
  category: string
  label: string
  models: { id: string }[]
}

export type SettingsModelsViewProps = {
  busy: boolean
  activeGroup: ChannelCredentialGroup | null
  activeModelCache: readonly ModelCapability[]
  selectedGroups: SelectedModelGroup[]
  panelOpen: boolean
  draftCategory: CategoryFilter
  draftKeyword: string
  draftChecked: ReadonlySet<string>
  draftList: ModelCapability[]
  onRefresh: () => void
  onOpenPanel: () => void
  onClosePanel: () => void
  onDraftCategoryChange: (category: CategoryFilter) => void
  onDraftKeywordChange: (keyword: string) => void
  onToggleDraft: (modelId: string, checked: boolean) => void
  onModelCategoryChange: (modelId: string, category: ModelCapability['category']) => void
  onDropSelectedModel: (modelId: string) => void
  onApplyDraft: () => void
}

export function SettingsModelsView({
  busy,
  activeGroup,
  activeModelCache,
  selectedGroups,
  panelOpen,
  draftCategory,
  draftKeyword,
  draftChecked,
  draftList,
  onRefresh,
  onOpenPanel,
  onClosePanel,
  onDraftCategoryChange,
  onDraftKeywordChange,
  onToggleDraft,
  onModelCategoryChange,
  onDropSelectedModel,
  onApplyDraft,
}: SettingsModelsViewProps) {
  return (
    <section className={styles.editorSection} data-settings-models>
      <div className={styles.modelsHead}>
        <div className={styles.modelsTitleBox}>
          <span className={styles.cardTitle}>模型列表</span>
          <span className={styles.cardSub}>
            {activeGroup
              ? `当前分组：${activeGroup.name}`
              : '从上游 api 自动拉取所有可用模型'}
          </span>
        </div>
        <button className={styles.ghostBtn} disabled={busy} onClick={onRefresh}>
          拉取模型
        </button>
        <button
          className={styles.ghostBtn}
          disabled={busy || activeModelCache.length === 0}
          onClick={onOpenPanel}
        >
          选择模型
        </button>
      </div>

      {activeModelCache.length === 0 ? (
        <p className={styles.modelsEmpty} data-models-empty>
          还没有拉取过模型。点「拉取模型」从上游取回全部可用模型，再点「选择模型」勾选要用的。
        </p>
      ) : selectedGroups.length === 0 ? (
        <p className={styles.modelsEmpty} data-models-none>
          上游有 {activeModelCache.length} 个模型，但还没勾选任何一个——画布的模型下拉只列这里选中的。
          点「选择模型」去挑。
        </p>
      ) : (
        <div className={styles.selectedGroups}>
          {selectedGroups.map((group) => (
            <div key={group.category} className={styles.selectedRow}>
              <span className={styles.selectedLabel}>{group.label}模型</span>
              <div className={styles.chips}>
                {group.models.map((model) => (
                  <span
                    key={model.id}
                    className={styles.chip}
                    data-model-chip
                    data-model-id={model.id}
                  >
                    {model.id}
                    <button
                      className={styles.chipX}
                      aria-label={`移除模型 ${model.id}`}
                      data-model-remove={model.id}
                      onClick={() => onDropSelectedModel(model.id)}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {panelOpen && (
        <div className={styles.panel} data-model-panel>
          <div className={styles.panelHead}>
            <span className={styles.panelTitle}>选择模型</span>
            <button
              className={styles.chipX}
              aria-label="关闭选择模型"
              onClick={onClosePanel}
            >
              ×
            </button>
          </div>
          <div className={styles.panelFilters}>
            <div className={styles.tabs}>
              {CATEGORY_FILTERS.map((category) => (
                <button
                  key={category.value}
                  className={
                    category.value === draftCategory
                      ? `${styles.tab} ${styles.tabOn}`
                      : styles.tab
                  }
                  data-model-tab={category.value}
                  onClick={() => onDraftCategoryChange(category.value)}
                >
                  {category.label}
                </button>
              ))}
            </div>
            <input
              className={`${styles.input} ${styles.search}`}
              data-model-search
              placeholder="搜索模型名称"
              value={draftKeyword}
              onChange={(event) => onDraftKeywordChange(event.target.value)}
            />
          </div>

          <ul className={styles.optionList}>
            {draftList.map((model) => (
              <li key={model.id}>
                <label className={styles.option} data-model-option={model.id}>
                  <input
                    type="checkbox"
                    checked={draftChecked.has(model.id)}
                    onChange={(event) => onToggleDraft(model.id, event.target.checked)}
                  />
                  <span className={styles.optionName}>{model.id}</span>
                  <ChoicePicker
                    name={`model-category-${model.id}`}
                    value={model.category}
                    ariaLabel={`${model.id} 的模型分类`}
                    compact
                    className={styles.categorySelect}
                    options={CATEGORY_FILTERS.filter(
                      (item) => item.value !== 'all',
                    ).map((item) => ({
                      value: item.value,
                      label: item.label,
                    }))}
                    onChange={(next) =>
                      onModelCategoryChange(model.id, next as ModelCapability['category'])
                    }
                  />
                </label>
              </li>
            ))}
            {draftList.length === 0 && (
              <li className={styles.optionEmpty}>
                {activeModelCache.length === 0
                  ? '没有可选的模型，先「拉取模型」'
                  : '没有匹配的模型'}
              </li>
            )}
          </ul>

          <div className={styles.panelFoot}>
            <button className={styles.ghostBtn} onClick={onClosePanel}>
              取消
            </button>
            <button
              className={styles.primary}
              disabled={busy}
              data-model-apply
              onClick={onApplyDraft}
            >
              应用到模型列表
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
