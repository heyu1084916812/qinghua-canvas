import type { EcommerceModeOptions } from '../../../domain/ecommerce/types'
import { EcommerceSelect } from '../EcommerceSelect'
import { styles } from './studioStyles'
import { modelIconFor } from './studioSharedViews'
import { ModeSpecificParameters } from './EcommerceStudioModeParameters'
import type { StudioMode } from './studioContracts'

export function EcommerceStudioModelFields({
  mode,
  modeOptions,
  chatModels,
  intentModel,
  chatTargetLabel,
  onConfigureChannels,
  onIntentModelChange,
  model,
  onGenerateModelChange,
  models,
  videoModels,
  setModeOption,
  toggleModeOption,
}: {
  mode: StudioMode
  modeOptions: EcommerceModeOptions
  chatModels: readonly string[]
  intentModel: string
  chatTargetLabel: string
  onConfigureChannels?: () => void
  onIntentModelChange?: (model: string) => void
  model: string
  onGenerateModelChange: (model: string) => void
  models: readonly string[]
  videoModels: readonly string[]
  setModeOption: (key: string, value: string | string[] | Record<string, number>) => void
  toggleModeOption: (key: string, id: string) => void
}) {
  return (
    <>
      {mode.id !== 'product-white' ? (
        <div className={styles.field} data-param-section="plan-model">
          <span className={styles.fieldHead}>
            <span className={styles.fieldLabel}>对话模型</span>
            {onConfigureChannels ? (
              <button
                type="button"
                className={styles.fieldAction}
                data-ecommerce-configure-channels
                onClick={onConfigureChannels}
              >
                模型服务
              </button>
            ) : null}
          </span>
          <EcommerceSelect
            ariaLabel="对话模型"
            name="intent-model"
            value={
              (chatModels.includes(intentModel) ? intentModel : undefined) ??
              (chatTargetLabel && chatModels.includes(chatTargetLabel)
                ? chatTargetLabel
                : undefined) ??
              chatModels[0] ??
              ''
            }
            onChange={(value) => onIntentModelChange?.(value)}
            placeholder="未配置对话模型"
            menuMinWidth={260}
            disabled={chatModels.length === 0}
            options={chatModels.map((item) => ({
              value: item,
              label: item,
              icon: modelIconFor(item),
            }))}
            dataAttributes={{ 'data-ecommerce-intent-model': true }}
          />
        </div>
      ) : null}

      <div className={styles.field} data-param-section="generate-model">
        <span className={styles.fieldLabel}>
          {mode.mediaKind === 'video' ? '视频模型' : '生成模型'}
        </span>
        <EcommerceSelect
          ariaLabel={mode.mediaKind === 'video' ? '视频模型' : '生成模型'}
          name="generate-model"
          value={model}
          onChange={onGenerateModelChange}
          placeholder="默认（按渠道解析）"
          menuMinWidth={250}
          options={[
            { value: '', label: '默认（按渠道解析）' },
            ...(mode.mediaKind === 'video' ? videoModels : models).map((item) => ({
              value: item,
              label: item,
              icon: modelIconFor(item),
            })),
          ]}
          dataAttributes={{ 'data-ecommerce-model': true }}
        />
      </div>

      <div data-param-section="mode">
        <ModeSpecificParameters
          modeId={mode.id}
          options={modeOptions}
          setOption={setModeOption}
          toggleOption={toggleModeOption}
        />
      </div>
    </>
  )
}
